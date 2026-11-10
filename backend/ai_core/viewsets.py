"""DRF ViewSets for the ai_core app.

* :class:`AICostLogViewSet` — read-only list / retrieve + ``budget``.
* :class:`PromptTemplateViewSet` — CRUD + ``activate`` + ``active``.
"""

from __future__ import annotations

from typing import Any

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet, ReadOnlyModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember

from .models import AICostLog, PromptTemplate
from .serializers import AICostLogSerializer, PromptTemplateSerializer
from .services import activate_template, check_budget, get_active_template


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve", "budget", "active"):
        return [IsAuthenticated(), IsTenantMember()]
    return [IsAuthenticated(), IsTenantMember(), HasPermission("ai_core.manage")]


###############################################################################
# AICostLogViewSet
###############################################################################


class AICostLogViewSet(ReadOnlyModelViewSet):
    """Read-only list / retrieve of LLM invocation cost rows + ``budget``."""

    pagination_class = CRMCursorPagination
    serializer_class = AICostLogSerializer
    queryset = AICostLog.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    @action(detail=False, methods=["get"], url_path="budget")
    def budget(self, request: Request) -> Response:
        """GET — return ``{spent, budget, remaining, period_start, period_end}``."""
        return Response(check_budget(tenant=request.tenant))


###############################################################################
# PromptTemplateViewSet
###############################################################################


class PromptTemplateViewSet(ModelViewSet):
    """CRUD + ``activate`` + ``active`` on :class:`PromptTemplate`."""

    pagination_class = CRMCursorPagination
    serializer_class = PromptTemplateSerializer
    queryset = PromptTemplate.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: PromptTemplateSerializer
    ) -> None:
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    @action(detail=True, methods=["post"], url_path="activate")
    def activate(self, request: Request, pk: str | None = None) -> Response:
        """POST — flip this template active + siblings inactive."""
        template: PromptTemplate = self.get_object()  # type: ignore[assignment]
        activate_template(template)
        return Response(PromptTemplateSerializer(template).data)

    @action(detail=False, methods=["get"], url_path="active")
    def active(self, request: Request) -> Response:
        """GET ``?name=...`` — return the active template for ``name``."""
        name = request.query_params.get("name", "")
        if not name:
            return Response(
                {"detail": "name query param is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        tpl = get_active_template(name, tenant=request.tenant)
        if tpl is None:
            return Response(
                {"detail": f"No active template for {name!r}."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(PromptTemplateSerializer(tpl).data)


__all__ = ["AICostLogViewSet", "PromptTemplateViewSet"]
