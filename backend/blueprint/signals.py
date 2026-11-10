"""Signal handlers for the blueprint app.

Wired in :meth:`blueprint.apps.BlueprintConfig.ready`.

On ``Deal.post_save(created=True)`` the receiver calls
:meth:`blueprint.services.BlueprintService.enforce_on_create` so a freshly
created deal whose pipeline has an active blueprint gets a
:class:`blueprint.models.BlueprintExecution` row attached. Deals without
an active blueprint are left alone (the receiver is a no-op).
"""

from __future__ import annotations

import logging
from typing import Any

from django.db.models.signals import post_save
from django.dispatch import receiver

from deals.models import Deal

log = logging.getLogger(__name__)


@receiver(post_save, sender=Deal)
def deal_post_save_enforce_blueprint(
    sender: type,
    instance: Deal,
    created: bool,
    raw: bool,
    **kwargs: Any,
) -> None:
    """Auto-create a :class:`BlueprintExecution` for a new deal.

    Skipped for:

    * raw loads (fixture installs).
    * updates (only fires on ``created=True``).
    * soft-delete / restore saves (``update_fields`` is
      ``{deleted_at, updated_at}``).
    * deals without a tenant (system / fixture loads).
    """
    if raw or not created or instance.tenant_id is None:
        return

    update_fields = kwargs.get("update_fields")
    if update_fields and "stage" not in update_fields and "pipeline" not in update_fields:
        # We only care about the initial create (no update_fields) or
        # saves that touch the deal's stage / pipeline. Soft-delete
        # saves set ``update_fields={"deleted_at", "updated_at"}``.
        return

    try:
        from blueprint.services import BlueprintService

        BlueprintService().enforce_on_create(instance)
    except Exception:  # pragma: no cover — defensive: never break a deal save
        log.exception(
            "deal_post_save_enforce_blueprint: failed for deal %s", instance.pk
        )


__all__ = ["deal_post_save_enforce_blueprint"]
