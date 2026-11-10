"""DRF ViewSets for the anomaly_detection app."""

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

from .models import Anomaly
from .serializers import AnomalySerializer
from .services import acknowledge_anomaly, get_trends, resolve_anomaly, scan_anomalies


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve", "trends"):
        return [IsAuthenticated(), IsTenantMember()]
    return [
        IsAuthenticated(),
        IsTenantMember(),
        HasPermission("anomaly_detection.manage"),
    ]


class AnomalyViewSet(ModelViewSet):
    """CRUD + ``acknowledge`` / ``resolve`` / ``trends`` / ``scan``."""

    pagination_class = CRMCursorPagination
    serializer_class = AnomalySerializer
    queryset = Anomaly.objects.select_related("tenant", "acknowledged_by")
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: AnomalySerializer
    ) -> None:
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    @action(detail=True, methods=["post"], url_path="acknowledge")
    def acknowledge(self, request: Request, pk: str | None = None) -> Response:
        """POST — mark the anomaly acknowledged by the caller."""
        anomaly: Anomaly = self.get_object()  # type: ignore[assignment]
        acknowledge_anomaly(anomaly, user=request.user)
        return Response(AnomalySerializer(anomaly).data)

    @action(detail=True, methods=["post"], url_path="resolve")
    def resolve(self, request: Request, pk: str | None = None) -> Response:
        """POST — mark the anomaly resolved."""
        anomaly: Anomaly = self.get_object()  # type: ignore[assignment]
        resolve_anomaly(anomaly, user=request.user)
        return Response(AnomalySerializer(anomaly).data)

    @action(detail=False, methods=["get"], url_path="trends")
    def trends(self, request: Request) -> Response:
        """GET ``?days=30`` — per-anomaly-type counts grouped by severity."""
        days = int(request.query_params.get("days", "30"))
        return Response({"trends": get_trends(tenant=request.tenant, days=days)})

    @action(detail=False, methods=["post"], url_path="scan")
    def scan(self, request: Request) -> Response:
        """POST — manually trigger an anomaly scan for the caller's tenant."""
        result = scan_anomalies(tenant=request.tenant)
        return Response(result, status=status.HTTP_200_OK)


__all__ = ["AnomalyViewSet"]
