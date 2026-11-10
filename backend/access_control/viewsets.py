"""DRF ViewSets for the access_control app.

Three ModelViewSets — full CRUD on :class:`IPAllowlist`,
:class:`SessionPolicy`, :class:`TrustedDevice`. Reads require
``IsAuthenticated`` + ``IsTenantMember``; writes additionally require
the ``access_control.manage`` permission.
"""

from __future__ import annotations

from typing import Any

from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember

from .models import IPAllowlist, SessionPolicy, TrustedDevice
from .serializers import (
    IPAllowlistSerializer,
    SessionPolicySerializer,
    TrustedDeviceSerializer,
)


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve"):
        return [IsAuthenticated(), IsTenantMember()]
    return [
        IsAuthenticated(),
        IsTenantMember(),
        HasPermission("access_control.manage"),
    ]


class IPAllowlistViewSet(ModelViewSet):
    """CRUD on :class:`IPAllowlist`."""

    pagination_class = CRMCursorPagination
    serializer_class = IPAllowlistSerializer
    queryset = IPAllowlist.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(self, serializer: IPAllowlistSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


class SessionPolicyViewSet(ModelViewSet):
    """CRUD on :class:`SessionPolicy`."""

    pagination_class = CRMCursorPagination
    serializer_class = SessionPolicySerializer
    queryset = SessionPolicy.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(self, serializer: SessionPolicySerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


class TrustedDeviceViewSet(ModelViewSet):
    """CRUD on :class:`TrustedDevice`."""

    pagination_class = CRMCursorPagination
    serializer_class = TrustedDeviceSerializer
    queryset = TrustedDevice.objects.select_related("tenant", "user")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(self, serializer: TrustedDeviceSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


__all__ = ["IPAllowlistViewSet", "SessionPolicyViewSet", "TrustedDeviceViewSet"]
