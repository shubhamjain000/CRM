"""Service layer for the profiles app.

Two public functions:

* :func:`build_permission_matrix` — return a flattened dict view of
  every module permission + field access for ``profile``.
* :func:`clone_profile` — deep-copy a profile (including its module
  permissions and field permissions).
"""

from __future__ import annotations

from typing import Any

from django.db import transaction

from .models import FieldPermission, Profile, ProfilePermission


###############################################################################
# build_permission_matrix
###############################################################################


def build_permission_matrix(profile: Profile) -> dict[str, Any]:
    """Return a flattened matrix of ``profile``'s permissions.

    Output shape::

        {
            "modules": {
                "lead": {
                    "can_view": True, "can_create": True, ...,
                    "fields": {"email": "editable", "ssn": "hidden"}
                },
                ...
            }
        }

    Modules with no explicit :class:`ProfilePermission` row default to
    all-``False``; fields with no explicit :class:`FieldPermission`
    default to ``visible``.
    """
    module_perms = {p.module: p for p in profile.permissions.all()}
    field_perms: dict[str, dict[str, str]] = {}
    for fp in profile.field_permissions.all():
        field_perms.setdefault(fp.module, {})[fp.field_name] = fp.access

    modules: dict[str, Any] = {}
    for module, perm in module_perms.items():
        modules[module] = {
            "can_view": perm.can_view,
            "can_create": perm.can_create,
            "can_edit": perm.can_edit,
            "can_delete": perm.can_delete,
            "can_export": perm.can_export,
            "can_share": perm.can_share,
            "fields": field_perms.get(module, {}),
        }
    # Modules with field permissions but no module-level row still surface
    # so the UI can show field overrides.
    for module, fields in field_perms.items():
        if module in modules:
            continue
        modules[module] = {
            "can_view": False, "can_create": False, "can_edit": False,
            "can_delete": False, "can_export": False, "can_share": False,
            "fields": fields,
        }
    return {"modules": modules}


###############################################################################
# clone_profile
###############################################################################


@transaction.atomic
def clone_profile(profile: Profile, new_name: str | None = None) -> Profile:
    """Deep-copy ``profile`` (permissions + field permissions).

    Clones are never ``is_standard``.
    """
    src_perms = list(profile.permissions.all())
    src_fields = list(profile.field_permissions.all())
    clone = Profile.objects.create(
        tenant=profile.tenant,
        name=new_name or f"{profile.name} (Copy)",
        description=profile.description,
        is_standard=False,
    )
    for src in src_perms:
        ProfilePermission.objects.create(
            tenant=profile.tenant,
            profile=clone,
            module=src.module,
            can_view=src.can_view,
            can_create=src.can_create,
            can_edit=src.can_edit,
            can_delete=src.can_delete,
            can_export=src.can_export,
            can_share=src.can_share,
        )
    for src in src_fields:
        FieldPermission.objects.create(
            tenant=profile.tenant,
            profile=clone,
            module=src.module,
            field_name=src.field_name,
            access=src.access,
        )
    return clone


__all__ = ["build_permission_matrix", "clone_profile"]
