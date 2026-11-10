"""DRF ViewSets for the sandbox app.

* :class:`SandboxViewSet` — CRUD + ``create_snapshot`` + ``compare`` +
  ``push_to_production``.
"""

from __future__ import annotations

from typing import Any

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember

from .filters import SandboxFilter
from .models import Sandbox
from .serializers import SandboxSerializer
from .services import compare_sandboxes, create_snapshot, push_to_production


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve", "compare"):
        return [IsAuthenticated(), IsTenantMember()]
    return [IsAuthenticated(), IsTenantMember(), HasPermission("sandbox.manage")]


###############################################################################
# SandboxViewSet
###############################################################################


class SandboxViewSet(ModelViewSet):
    """CRUD + ``create_snapshot`` + ``compare`` + ``push_to_production``."""

    pagination_class = CRMCursorPagination
    serializer_class = SandboxSerializer
    filterset_class = SandboxFilter
    queryset = Sandbox.objects.select_related("tenant").all()

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: SandboxSerializer
    ) -> None:
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant
        )

    @action(detail=False, methods=["post"], url_path="create_snapshot")
    def create_snapshot(self, request: Request) -> Response:
        """POST ``{branch_name, description?}`` — capture current state into a new sandbox."""
        branch_name = (request.data or {}).get("branch_name")
        if not branch_name:
            return Response(
                {"detail": "branch_name is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        snapshot = create_snapshot(request.tenant)
        sandbox = Sandbox.objects.create(
            tenant=request.tenant,
            branch_name=branch_name,
            description=(request.data or {}).get("description", ""),
            snapshot_data=snapshot,
        )
        return Response(
            SandboxSerializer(sandbox).data, status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=["post"], url_path="compare")
    def compare(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{target_sandbox_id}`` — diff this sandbox against another."""
        source: Sandbox = self.get_object()  # type: ignore[assignment]
        target_id = (request.data or {}).get("target_sandbox_id")
        if not target_id:
            return Response(
                {"detail": "target_sandbox_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            target = Sandbox.objects.get(pk=target_id, tenant=request.tenant)
        except Sandbox.DoesNotExist:
            return Response(
                {"detail": "Target sandbox not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(compare_sandboxes(source, target))

    @action(detail=True, methods=["post"], url_path="push_to_production")
    def push_to_production(self, request: Request, pk: str | None = None) -> Response:
        """POST — mark this sandbox as merged (inactive)."""
        sandbox: Sandbox = self.get_object()  # type: ignore[assignment]
        result = push_to_production(sandbox)
        return Response(result)


__all__ = ["SandboxViewSet"]
