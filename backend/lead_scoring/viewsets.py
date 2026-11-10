"""DRF ViewSets for the lead_scoring app.

* :class:`LeadScoreViewSet` — read-only list / retrieve + ``score_lead``
  (POST ``?lead_id=...``) + ``hot_leads`` (GET).
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

from .models import LeadScore
from .serializers import LeadScoreSerializer
from .services import get_hot_leads, score_lead


class LeadScoreViewSet(ReadOnlyModelViewSet):
    """List / retrieve LeadScore rows + ``score_lead`` + ``hot_leads``."""

    pagination_class = CRMCursorPagination
    serializer_class = LeadScoreSerializer
    queryset = LeadScore.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        if self.action in ("list", "retrieve", "hot_leads"):
            return [IsAuthenticated(), IsTenantMember()]
        return [IsAuthenticated(), IsTenantMember(), HasPermission("lead_scoring.manage")]

    @action(detail=False, methods=["post"], url_path="score_lead")
    def score_lead_action(self, request: Request) -> Response:
        """POST ``{lead_id}`` — compute + persist the score; return the row."""
        lead_id = request.data.get("lead_id")
        if not lead_id:
            return Response(
                {"detail": "lead_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        score = score_lead(str(lead_id), tenant=request.tenant)
        return Response(LeadScoreSerializer(score).data)

    @action(detail=False, methods=["get"], url_path="hot_leads")
    def hot_leads(self, request: Request) -> Response:
        """GET ``?limit=50`` — top hot-lead rows (score > 80)."""
        limit = int(request.query_params.get("limit", "50"))
        qs = get_hot_leads(tenant=request.tenant, limit=limit)
        return Response(LeadScoreSerializer(qs, many=True).data)


__all__ = ["LeadScoreViewSet"]
