"""DRF ViewSets for the profiles app.

* :class:`ProfileViewSet` — CRUD + ``permission_matrix``.
* :class:`ProfilePermissionViewSet` — CRUD.
* :class:`FieldPermissionViewSet` — CRUD.
"""

from __future__ import annotations

from typing import Any

from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember

from .filters import FieldPermissionFilter, ProfileFilter, ProfilePermissionFilter
from .models import FieldPermission, Profile, ProfilePermission
from .serializers import (
    FieldPermissionSerializer,
    ProfilePermissionSerializer,
    ProfileSerializer,
)
from .services import build_permission_matrix


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve", "permission_matrix"):
        return [IsAuthenticated(), IsTenantMember()]
    return [IsAuthenticated(), IsTenantMember(), HasPermission("profiles.manage")]


###############################################################################
# ProfileViewSet
###############################################################################


class ProfileViewSet(ModelViewSet):
    """CRUD + ``permission_matrix`` on :class:`Profile`."""

    pagination_class = CRMCursorPagination
    serializer_class = ProfileSerializer
    filterset_class = ProfileFilter
    queryset = Profile.objects.select_related("tenant").prefetch_related(
        "permissions", "field_permissions"
    )

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: ProfileSerializer
    ) -> None:
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant
        )

    @action(detail=True, methods=["get"], url_path="permission_matrix")
    def permission_matrix(self, request: Request, pk: str | None = None) -> Response:
        """GET — flattened per-module CRUD + per-field access matrix."""
        profile: Profile = self.get_object()  # type: ignore[assignment]
        return Response(build_permission_matrix(profile))


###############################################################################
# ProfilePermissionViewSet
###############################################################################


class ProfilePermissionViewSet(ModelViewSet):
    """CRUD on :class:`ProfilePermission`."""

    pagination_class = CRMCursorPagination
    serializer_class = ProfilePermissionSerializer
    filterset_class = ProfilePermissionFilter
    queryset = ProfilePermission.objects.select_related("tenant", "profile").all()

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: ProfilePermissionSerializer
    ) -> None:
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant
        )


###############################################################################
# FieldPermissionViewSet
###############################################################################


class FieldPermissionViewSet(ModelViewSet):
    """CRUD on :class:`FieldPermission`."""

    pagination_class = CRMCursorPagination
    serializer_class = FieldPermissionSerializer
    filterset_class = FieldPermissionFilter
    queryset = FieldPermission.objects.select_related("tenant", "profile").all()

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: FieldPermissionSerializer
    ) -> None:
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant
        )


__all__ = [
    "FieldPermissionViewSet",
    "ProfilePermissionViewSet",
    "ProfileViewSet",
]
