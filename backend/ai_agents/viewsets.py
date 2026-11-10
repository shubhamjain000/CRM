"""DRF ViewSets for the ai_agents app.

* :class:`AIAgentRunViewSet` — read-only list / retrieve + ``trigger``
  (POST ``{agent_type, target_module?, target_id?}`` — synchronously
  runs the agent + returns the row) + ``results`` (GET on detail —
  returns the row's ``result`` JSON).
"""

from __future__ import annotations

from typing import Any

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ReadOnlyModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember

from .models import AIAgentRun
from .serializers import AIAgentRunSerializer, TriggerSerializer
from .services import run_agent


class AIAgentRunViewSet(ReadOnlyModelViewSet):
    """Read-only list / retrieve + ``trigger`` + ``results``."""

    pagination_class = CRMCursorPagination
    serializer_class = AIAgentRunSerializer
    queryset = AIAgentRun.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        if self.action in ("list", "retrieve", "results"):
            return [IsAuthenticated(), IsTenantMember()]
        return [IsAuthenticated(), IsTenantMember(), HasPermission("ai_agents.manage")]

    @action(detail=False, methods=["post"], url_path="trigger")
    def trigger(self, request: Request) -> Response:
        """POST ``{agent_type, target_module?, target_id?}`` — run the agent."""
        ser = TriggerSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            run = run_agent(
                ser.validated_data["agent_type"],
                target_module=ser.validated_data["target_module"],
                target_id=ser.validated_data["target_id"],
                tenant=request.tenant,
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            AIAgentRunSerializer(run).data, status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=["get"], url_path="results")
    def results(self, request: Request, pk: str | None = None) -> Response:
        """GET — return the row's ``result`` JSON."""
        run: AIAgentRun = self.get_object()  # type: ignore[assignment]
        return Response({"result": run.result, "status": run.status})


__all__ = ["AIAgentRunViewSet"]
