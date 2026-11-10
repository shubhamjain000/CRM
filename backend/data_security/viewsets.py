"""DRF ViewSets for the data_security app.

Two ModelViewSets — full CRUD on :class:`DataClassification` and
:class:`RetentionPolicy`. Reads require ``IsAuthenticated`` +
``IsTenantMember``; writes additionally require the
``data_security.manage`` permission.
"""

from __future__ import annotations

from typing import Any

from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember

from .models import DataClassification, RetentionPolicy
from .serializers import DataClassificationSerializer, RetentionPolicySerializer


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve"):
        return [IsAuthenticated(), IsTenantMember()]
    return [
        IsAuthenticated(),
        IsTenantMember(),
        HasPermission("data_security.manage"),
    ]


class DataClassificationViewSet(ModelViewSet):
    """CRUD on :class:`DataClassification`."""

    pagination_class = CRMCursorPagination
    serializer_class = DataClassificationSerializer
    queryset = DataClassification.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: DataClassificationSerializer
    ) -> None:
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


class RetentionPolicyViewSet(ModelViewSet):
    """CRUD on :class:`RetentionPolicy`."""

    pagination_class = CRMCursorPagination
    serializer_class = RetentionPolicySerializer
    queryset = RetentionPolicy.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: RetentionPolicySerializer
    ) -> None:
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


__all__ = ["DataClassificationViewSet", "RetentionPolicyViewSet"]
