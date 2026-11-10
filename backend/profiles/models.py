"""Database models for the profiles app (Phase 17).

Three tenant-scoped models:

* :class:`Profile` — a named permission profile. ``is_standard`` marks
  the tenant's built-in profiles (Administrator / Standard / Read-Only
  etc.) which cannot be deleted.
* :class:`ProfilePermission` — per-module CRUD + export + share flags.
  One row per (profile, module).
* :class:`FieldPermission` — per-field access level
  (``hidden`` / ``visible`` / ``read_only`` / ``editable``). One row
  per (profile, module, field_name).

These are the data backing the :class:`api.permissions.HasPermission`
gate at the viewset layer; the runtime check resolves the user's
profile → module permission → CRUD flag and short-circuits the request
when the flag is off. (Wiring that runtime hook is left to a follow-up
phase — the schema + admin UI ship here.)
"""

from __future__ import annotations

from django.db import models

from api.models import TenantModel

###############################################################################
# Constants — access levels
###############################################################################

ACCESS_HIDDEN = "hidden"
ACCESS_VISIBLE = "visible"
ACCESS_READ_ONLY = "read_only"
ACCESS_EDITABLE = "editable"
ACCESS_CHOICES = [
    (ACCESS_HIDDEN, "Hidden"),
    (ACCESS_VISIBLE, "Visible"),
    (ACCESS_READ_ONLY, "Read Only"),
    (ACCESS_EDITABLE, "Editable"),
]


###############################################################################
# Profile
###############################################################################


class Profile(TenantModel):
    """A named permission profile for this tenant.

    ``is_standard`` marks the tenant's built-in profiles which cannot
    be deleted (only their permissions edited).
    """

    name = models.CharField(max_length=100, db_index=True)
    description = models.TextField(blank=True, default="")
    is_standard = models.BooleanField(default=False, db_index=True)

    class Meta:
        db_table = "profiles_profile"
        verbose_name = "profile"
        verbose_name_plural = "profiles"
        unique_together = (("tenant", "name"),)
        indexes = [
            models.Index(fields=["tenant", "is_standard"], name="profile_standard_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.name}{' (standard)' if self.is_standard else ''}"


###############################################################################
# ProfilePermission
###############################################################################


class ProfilePermission(TenantModel):
    """Per-module CRUD + export + share flags for a profile.

    ``module`` is the string slug of a core or custom module. Exactly
    one row per (profile, module) — the unique_together constraint
    enforces this.
    """

    profile = models.ForeignKey(
        Profile, on_delete=models.CASCADE, related_name="permissions"
    )
    module = models.CharField(max_length=100, db_index=True)
    can_view = models.BooleanField(default=False)
    can_create = models.BooleanField(default=False)
    can_edit = models.BooleanField(default=False)
    can_delete = models.BooleanField(default=False)
    can_export = models.BooleanField(default=False)
    can_share = models.BooleanField(default=False)

    class Meta:
        db_table = "profiles_permission"
        verbose_name = "profile permission"
        verbose_name_plural = "profile permissions"
        unique_together = (("profile", "module"),)
        indexes = [
            models.Index(fields=["profile", "module"], name="pp_module_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.profile.name}/{self.module}"


###############################################################################
# FieldPermission
###############################################################################


class FieldPermission(TenantModel):
    """Per-field access level for a (profile, module, field) triple.

    ``access`` is one of ``hidden`` / ``visible`` / ``read_only`` /
    ``editable``. Defaults to ``visible``.
    """

    profile = models.ForeignKey(
        Profile, on_delete=models.CASCADE, related_name="field_permissions"
    )
    module = models.CharField(max_length=100, db_index=True)
    field_name = models.CharField(max_length=100, db_index=True)
    access = models.CharField(
        max_length=16, choices=ACCESS_CHOICES, default=ACCESS_VISIBLE
    )

    class Meta:
        db_table = "profiles_fieldpermission"
        verbose_name = "field permission"
        verbose_name_plural = "field permissions"
        unique_together = (("profile", "module", "field_name"),)
        indexes = [
            models.Index(fields=["profile", "module"], name="fp_module_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.profile.name}/{self.module}.{self.field_name}={self.access}"


__all__ = [
    "ACCESS_CHOICES",
    "ACCESS_EDITABLE",
    "ACCESS_HIDDEN",
    "ACCESS_READ_ONLY",
    "ACCESS_VISIBLE",
    "FieldPermission",
    "Profile",
    "ProfilePermission",
]
