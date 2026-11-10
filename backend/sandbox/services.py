"""Service layer for the sandbox app.

Three public functions:

* :func:`create_snapshot` — capture a tenant's customisation state
  (custom_modules + layouts + profiles + territories + canvas +
  template_builder) into a JSON dict.
* :func:`compare_sandboxes` — diff two snapshots at the top-level
  section level.
* :func:`push_to_production` — placeholder for the production-push
  pipeline. The full implementation (which actually mutates production
  state) is deferred to a follow-up phase; here we just mark the
  sandbox as inactive.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from django.utils import timezone

from .models import Sandbox

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization


###############################################################################
# create_snapshot
###############################################################################


def create_snapshot(tenant: "Organization") -> dict[str, Any]:  # type: ignore[no-untyped-def]
    """Capture a tenant's customisation state into a JSON dict.

    Sections captured: ``custom_modules``, ``layouts``, ``profiles``,
    ``territories``, ``canvas``, ``template_builder``. Each section is
    a list of dicts (one per row, primary key + key fields only).
    """
    snapshot: dict[str, Any] = {
        "custom_modules": [],
        "layouts": [],
        "profiles": [],
        "territories": [],
        "canvas": None,
        "template_builder": {"emails": [], "pdfs": []},
        "captured_at": timezone.now().isoformat(),
    }

    # Custom modules + fields (records excluded for brevity).
    from custom_modules.models import CustomModule, CustomModuleField  # noqa: PLC0415

    for module in CustomModule.objects.filter(tenant=tenant):
        snapshot["custom_modules"].append({
            "id": module.pk,
            "name": module.name,
            "slug": module.slug,
            "fields": [
                {"api_name": f.api_name, "field_type": f.field_type}
                for f in CustomModuleField.objects.filter(module=module)
            ],
        })

    # Layouts + sections.
    from layouts.models import Layout  # noqa: PLC0415

    for layout in Layout.objects.filter(tenant=tenant):
        snapshot["layouts"].append({
            "id": layout.pk,
            "module": layout.module,
            "name": layout.name,
            "profile_id": layout.profile_id,
            "section_count": layout.sections.count(),
        })

    # Profiles + permission count.
    from profiles.models import Profile  # noqa: PLC0415

    for profile in Profile.objects.filter(tenant=tenant):
        snapshot["profiles"].append({
            "id": profile.pk,
            "name": profile.name,
            "permission_count": profile.permissions.count(),
            "field_permission_count": profile.field_permissions.count(),
        })

    # Territories.
    from territories.models import Territory  # noqa: PLC0415

    for territory in Territory.objects.filter(tenant=tenant):
        snapshot["territories"].append({
            "id": territory.pk,
            "name": territory.name,
            "member_count": territory.members.count(),
        })

    # Canvas theme.
    from canvas.models import CanvasTheme  # noqa: PLC0415

    theme = CanvasTheme.objects.filter(tenant=tenant).first()
    if theme is not None:
        snapshot["canvas"] = {
            "id": theme.pk,
            "primary_color": theme.primary_color,
            "density": theme.density,
            "sidebar_style": theme.sidebar_style,
        }

    # Template builder.
    from template_builder.models import EmailTemplate, PdfTemplate  # noqa: PLC0415

    snapshot["template_builder"]["emails"] = [
        {"id": t.pk, "name": t.name, "category": t.category}
        for t in EmailTemplate.objects.filter(tenant=tenant)
    ]
    snapshot["template_builder"]["pdfs"] = [
        {"id": t.pk, "name": t.name, "category": t.category}
        for t in PdfTemplate.objects.filter(tenant=tenant)
    ]

    return snapshot


###############################################################################
# compare_sandboxes
###############################################################################


def compare_sandboxes(
    source: Sandbox, target: Sandbox
) -> dict[str, Any]:
    """Diff two snapshots at the top-level section level.

    Returns ``{section: {source_count, target_count, delta}}`` for
    each section present in either snapshot. The diff is intentionally
    coarse (counts only) — the deep per-row diff is deferred to a
    follow-up phase.
    """
    src = source.snapshot_data or {}
    tgt = target.snapshot_data or {}

    sections = set(src) | set(tgt)
    out: dict[str, Any] = {}
    for section in sorted(sections):
        src_val = src.get(section)
        tgt_val = tgt.get(section)
        src_count = (
            len(src_val) if isinstance(src_val, (list, dict)) else (1 if src_val else 0)
        )
        tgt_count = (
            len(tgt_val) if isinstance(tgt_val, (list, dict)) else (1 if tgt_val else 0)
        )
        out[section] = {
            "source_count": src_count,
            "target_count": tgt_count,
            "delta": tgt_count - src_count,
        }
    return {"sections": out}


###############################################################################
# push_to_production
###############################################################################


def push_to_production(sandbox: Sandbox) -> dict[str, Any]:  # type: ignore[no-untyped-def]
    """Mark ``sandbox`` as merged (inactive).

    The full production-push pipeline (which mutates production state
    by replaying the snapshot) is deferred to a follow-up phase. Here
    we just flip the ``is_active`` flag and return a summary.
    """
    if not sandbox.is_active:
        return {"status": "already_merged", "sandbox_id": sandbox.pk}
    sandbox.is_active = False
    sandbox.save(update_fields=["is_active", "updated_at"])
    return {
        "status": "merged",
        "sandbox_id": sandbox.pk,
        "branch_name": sandbox.branch_name,
    }


__all__ = ["compare_sandboxes", "create_snapshot", "push_to_production"]
