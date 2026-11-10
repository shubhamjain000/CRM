"""Celery tasks for the custom_fields app.

The ``post_save`` signal on :class:`custom_fields.models.CustomField`
dispatches :func:`backfill_defaults_for_field` so that adding a new custom
field with a default value will populate it on every existing record of the
target module (async, on the worker).
"""

from __future__ import annotations

import logging
from typing import Any

from celery import shared_task
from django.apps import apps

from .services import apply_defaults_for_module, resolve_module_model

log = logging.getLogger(__name__)


@shared_task(bind=True, name="custom_fields.backfill_defaults_for_field")
def backfill_defaults_for_field(self: Any, *, field_id: int, module: str, tenant_id: int) -> dict[str, Any]:
    """Backfill the default value of ``field`` onto every existing record.

    Resolves the model class for ``module``, then iterates the tenant-scoped
    queryset calling :func:`custom_fields.services.apply_defaults_for_module`.

    Returns a small summary dict for the audit trail.
    """
    from api.managers import tenant_context
    from api.models import Organization

    tenant = Organization.objects.filter(pk=tenant_id).first()
    if tenant is None:
        log.warning("backfill_defaults_for_field: tenant %s missing; aborting.", tenant_id)
        return {"field_id": field_id, "touched": 0, "reason": "tenant_missing"}

    try:
        model = resolve_module_model(module)
    except ValueError as exc:
        log.warning("backfill_defaults_for_field: %s", exc)
        return {"field_id": field_id, "touched": 0, "reason": "bad_module"}

    with tenant_context(tenant):
        touched = apply_defaults_for_module(tenant_id=tenant_id, module=module, model=model)
    log.info("backfill_defaults_for_field: field=%s module=%s touched=%s", field_id, module, touched)
    return {"field_id": field_id, "module": module, "touched": touched}


@shared_task(name="custom_fields.recompute_formulas")
def recompute_formulas() -> dict[str, Any]:
    """Iterate every tenant × module and recompute formula/rollup custom fields.

    The beat schedule dispatches this task with no arguments so it can sweep
    all tenants at runtime (django-celery-beat's static schedule doesn't
    support per-tenant kwargs). The actual formula engine lands in a later
    phase; this task is registered now so the wiring is in place.

    Returns a summary dict for the audit trail.
    """
    from api.managers import tenant_context
    from api.models import Organization
    from .models import MODULE_CHOICES
    from .services import get_custom_fields

    summary: dict[str, Any] = {"tenants": 0, "fields_recomputed": 0}
    for org in Organization.objects.filter(is_active=True).iterator(chunk_size=200):
        with tenant_context(org):
            summary["tenants"] += 1
            for module, _label in MODULE_CHOICES:
                fields = get_custom_fields(tenant_id=org.pk, module=module)
                # Only formula/rollup fields are recomputed.
                for field in fields:
                    if field.field_type in {"formula", "rollup_summary"}:
                        # Placeholder — actual recompute logic lands in a later phase.
                        log.info(
                            "recompute_formulas: tenant=%s module=%s field=%s (no-op stub)",
                            org.pk, module, field.api_name,
                        )
                        summary["fields_recomputed"] += 1
    log.info(
        "recompute_formulas: tenants=%s fields_recomputed=%s",
        summary["tenants"], summary["fields_recomputed"],
    )
    return summary


def apps_get_model(app_label: str, model_name: str) -> type:  # pragma: no cover — thin wrapper
    """Tiny wrapper exposed for testability."""
    return apps.get_model(app_label, model_name)
