"""DRF ViewSets for the layouts app.

* :class:`LayoutViewSet` — CRUD + ``fields``.
* :class:`LayoutSectionViewSet` — CRUD.
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

from .filters import LayoutFilter, LayoutSectionFilter
from .models import Layout, LayoutSection
from .serializers import LayoutSectionSerializer, LayoutSerializer
from .services import get_fields_for_layout


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve", "fields"):
        return [IsAuthenticated(), IsTenantMember()]
    return [IsAuthenticated(), IsTenantMember(), HasPermission("layouts.manage")]


###############################################################################
# LayoutViewSet
###############################################################################


class LayoutViewSet(ModelViewSet):
    """CRUD + ``fields`` on :class:`Layout`."""

    pagination_class = CRMCursorPagination
    serializer_class = LayoutSerializer
    filterset_class = LayoutFilter
    queryset = Layout.objects.select_related("tenant", "profile").prefetch_related(
        "sections"
    )

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: LayoutSerializer
    ) -> None:
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant
        )

    @action(detail=True, methods=["get"], url_path="fields")
    def fields(self, request: Request, pk: str | None = None) -> Response:
        """GET — flattened ordered field list for this layout."""
        layout: Layout = self.get_object()  # type: ignore[assignment]
        return Response({"fields": get_fields_for_layout(layout)})


###############################################################################
# LayoutSectionViewSet
###############################################################################


class LayoutSectionViewSet(ModelViewSet):
    """CRUD on :class:`LayoutSection`."""

    pagination_class = CRMCursorPagination
    serializer_class = LayoutSectionSerializer
    filterset_class = LayoutSectionFilter
    queryset = LayoutSection.objects.select_related("tenant", "layout").all()

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: LayoutSectionSerializer
    ) -> None:
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant
        )


__all__ = ["LayoutSectionViewSet", "LayoutViewSet"]
