"""DRF ViewSets for the sentiment_analysis app.

* :class:`SentimentViewSet` — read-only list / retrieve + ``analyze``
  (POST ``{module, record_id, text?}``) + ``trend`` (GET) + ``heatmap``
  (GET).
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

from .models import Sentiment
from .serializers import SentimentSerializer
from .services import analyze_record, get_heatmap, get_trend


class SentimentViewSet(ReadOnlyModelViewSet):
    """List / retrieve Sentiment rows + ``analyze`` / ``trend`` / ``heatmap``."""

    pagination_class = CRMCursorPagination
    serializer_class = SentimentSerializer
    queryset = Sentiment.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        if self.action in ("list", "retrieve", "trend", "heatmap"):
            return [IsAuthenticated(), IsTenantMember()]
        return [
            IsAuthenticated(),
            IsTenantMember(),
            HasPermission("sentiment_analysis.manage"),
        ]

    @action(detail=False, methods=["post"], url_path="analyze")
    def analyze(self, request: Request) -> Response:
        """POST ``{module, record_id, text?}`` — analyze + persist."""
        module = request.data.get("module")
        record_id = request.data.get("record_id")
        if not module or not record_id:
            return Response(
                {"detail": "module + record_id are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        text = request.data.get("text")
        sent = analyze_record(module, str(record_id), text=text, tenant=request.tenant)
        return Response(SentimentSerializer(sent).data)

    @action(detail=True, methods=["get"], url_path="trend")
    def trend(self, request: Request, pk: str | None = None) -> Response:
        """GET ``?module=email&record_id=42&limit=30`` — last N rows."""
        module = request.query_params.get("module", "")
        record_id = request.query_params.get("record_id", "")
        limit = int(request.query_params.get("limit", "30"))
        if not module or not record_id:
            return Response(
                {"detail": "module + record_id are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        rows = get_trend(module, record_id, tenant=request.tenant, limit=limit)
        return Response(SentimentSerializer(rows, many=True).data)

    @action(detail=False, methods=["get"], url_path="heatmap")
    def heatmap(self, request: Request) -> Response:
        """GET ``?days=30`` — ``{record_module: avg_sentiment}``."""
        days = int(request.query_params.get("days", "30"))
        return Response({"heatmap": get_heatmap(tenant=request.tenant, days=days)})


__all__ = ["SentimentViewSet"]
