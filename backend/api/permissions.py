"""DRF permission classes and role-permission resolution helpers.

Permission strategy
-------------------
1. The :class:`api.middleware.TenantMiddleware` ensures ``request.tenant`` is
   set for any tenant-scoped route and stashes the user's
   :class:`api.models.TenantMembership` on ``request.tenant_membership``.
2. :class:`IsTenantMember` is the base check — the user must have an *active*
   membership in the current tenant.
3. :class:`IsOrgAdmin` / :class:`HasPermission` layer additional checks on top.
4. :class:`FieldLevelPermissions` is mixed into serializers / viewsets to
   redact or read-only fields based on :class:`api.models.FieldSecurity`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Iterable

from rest_framework.permissions import BasePermission, SAFE_METHODS

if TYPE_CHECKING:  # pragma: no cover
    from rest_framework.request import Request

    from api.models import Role, TenantMembership


###############################################################################
# Role permission resolution (with hierarchy inheritance)
###############################################################################


def resolve_permissions(role: "Role | None") -> set[str]:
    """Return the effective permission strings for ``role``.

    Walks up the ``parent`` chain so a child role inherits its ancestors'
    permissions. Cycles are guarded against with a visited set.
    """
    if role is None:
        return set()
    seen: set[int] = set()
    perms: set[str] = set()
    current: "Role | None" = role
    while current is not None and current.pk not in seen:
        seen.add(current.pk)
        perms.update(current.permissions or [])
        current = current.parent
    return perms


def user_permissions_for_tenant(membership: "TenantMembership | None") -> set[str]:
    """Convenience: effective permissions for a user's tenant membership."""
    if membership is None or not membership.is_active:
        return set()
    return resolve_permissions(membership.role)


def is_admin_role(role: "Role | None") -> bool:
    """Return ``True`` if ``role`` is owner/admin (by name) or carries the
    ``org.admin`` permission."""
    if role is None:
        return False
    name = (role.name or "").lower()
    if name in {"owner", "admin"}:
        return True
    return "org.admin" in resolve_permissions(role)


###############################################################################
# Permission classes
###############################################################################


class IsTenantMember(BasePermission):
    """Allow access only when the user is an active member of ``request.tenant``."""

    message = "You are not a member of this organization."

    def has_permission(self, request: "Request", view: Any) -> bool:
        if not request.user or not request.user.is_authenticated:
            return False
        membership = getattr(request, "tenant_membership", None)
        if membership is None or not membership.is_active:
            return False
        return True


class IsOrgAdmin(IsTenantMember):
    """Member must additionally be an admin/owner of the tenant."""

    message = "Organization admin privileges required."

    def has_permission(self, request: "Request", view: Any) -> bool:
        if not super().has_permission(request, view):
            return False
        return is_admin_role(getattr(request, "tenant_membership", None).role)


class HasPermission(BasePermission):
    """Role-based permission check.

    Usage::

        class UserListView(APIView):
            permission_classes = [IsTenantMember, HasPermission("users.read")]
    """

    def __init__(self, required_permission: str | Iterable[str]):
        super().__init__()
        if isinstance(required_permission, str):
            self.required: set[str] = {required_permission}
        else:
            self.required = set(required_permission)

    def has_permission(self, request: "Request", view: Any) -> bool:
        membership = getattr(request, "tenant_membership", None)
        if membership is None or not membership.is_active:
            return False
        perms = user_permissions_for_tenant(membership)
        return self.required.issubset(perms)

    def __call__(self) -> "HasPermission":
        # DRF instantiates permission_classes with no args; expose an instance
        # when used as a factory. (Standard pattern.)
        return self


class IsReadOnly(BasePermission):
    """Allow only ``GET`` / ``HEAD`` / ``OPTIONS``."""

    def has_permission(self, request: "Request", view: Any) -> bool:
        return request.method in SAFE_METHODS


class IsSelfOrOrgAdmin(BasePermission):
    """Object permission: a user can read/edit their own record; admins can do any."""

    def has_object_permission(self, request: "Request", view: Any, obj: Any) -> bool:
        membership = getattr(request, "tenant_membership", None)
        if membership is not None and is_admin_role(membership.role):
            return True
        return getattr(obj, "pk", None) == getattr(request.user, "pk", None)


###############################################################################
# Field-level security
###############################################################################


def field_security_map(role: "Role | None", model_label: str) -> dict[str, str]:
    """Return ``{field: level}`` for ``role`` on the given ``model_label``.

    ``model_label`` is ``"app_label.model_name"`` (lowercased). Inherits up the
    parent chain — a child's explicit rule wins over a parent's.
    """
    if role is None:
        return {}
    from api.models import FieldSecurity

    out: dict[str, str] = {}
    seen: set[int] = set()
    current: "Role | None" = role
    while current is not None and current.pk not in seen:
        seen.add(current.pk)
        rules = FieldSecurity.objects.filter(role=current, model=model_label)
        for rule in rules:
            out.setdefault(rule.field, rule.level)
        current = current.parent
    return out


def apply_field_security(
    *,
    instance: Any,
    representation: dict[str, Any],
    role: "Role | None",
    model_label: str,
) -> dict[str, Any]:
    """Mutate ``representation`` in-place per FieldSecurity rules.

    * ``hidden`` fields are removed.
    * ``read_only`` fields are kept on reads but the view layer is expected to
      drop them on writes (see :class:`FieldLevelPermissions`).
    Returns the (mutated) representation.
    """
    rules = field_security_map(role, model_label)
    for field, level in rules.items():
        if level == FieldSecurity.LEVEL_HIDDEN:
            representation.pop(field, None)
    return representation


class FieldLevelPermissions:
    """Mixin for serializers that want to honor FieldSecurity on output.

    Serializers call ``self.apply_field_security(representation)`` from
    ``to_representation``.
    """

    def get_role(self) -> "Role | None":  # pragma: no cover — depends on request context
        request = self.context.get("request")  # type: ignore[attr-defined]
        membership = getattr(request, "tenant_membership", None) if request else None
        return getattr(membership, "role", None) if membership else None

    def apply_field_security(self, representation: dict[str, Any], instance: Any | None = None) -> dict[str, Any]:
        role = self.get_role()
        model_label = self._model_label()  # type: ignore[attr-defined]
        return apply_field_security(
            instance=instance, representation=representation, role=role, model_label=model_label
        )
