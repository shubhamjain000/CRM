"""DRF ViewSets for the deal_prediction app.

* :class:`PredictedDealValueViewSet` — read-only list / retrieve +
  ``predict`` (POST ``?deal_id=...``) + ``at_risk`` (GET).
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

from .models import PredictedDealValue
from .serializers import PredictedDealValueSerializer
from .services import get_at_risk, predict_deal


class PredictedDealValueViewSet(ReadOnlyModelViewSet):
    """List / retrieve PredictedDealValue rows + ``predict`` + ``at_risk``."""

    pagination_class = CRMCursorPagination
    serializer_class = PredictedDealValueSerializer
    queryset = PredictedDealValue.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        if self.action in ("list", "retrieve", "at_risk"):
            return [IsAuthenticated(), IsTenantMember()]
        return [
            IsAuthenticated(),
            IsTenantMember(),
            HasPermission("deal_prediction.manage"),
        ]

    @action(detail=False, methods=["post"], url_path="predict")
    def predict(self, request: Request) -> Response:
        """POST ``{deal_id}`` — compute + persist the prediction."""
        deal_id = request.data.get("deal_id")
        if not deal_id:
            return Response(
                {"detail": "deal_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        pred = predict_deal(str(deal_id), tenant=request.tenant)
        return Response(PredictedDealValueSerializer(pred).data)

    @action(detail=False, methods=["get"], url_path="at_risk")
    def at_risk(self, request: Request) -> Response:
        """GET ``?limit=50`` — deals whose probability dropped > 20% week-over-week."""
        limit = int(request.query_params.get("limit", "50"))
        qs = get_at_risk(tenant=request.tenant, limit=limit)
        return Response(PredictedDealValueSerializer(qs, many=True).data)


__all__ = ["PredictedDealValueViewSet"]
