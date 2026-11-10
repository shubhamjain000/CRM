"""DRF ViewSets for the audit app.

* :class:`AuditLogViewSet` — read-only list / retrieve +
  ``per_record`` filter action.
"""

from __future__ import annotations

from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ReadOnlyModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import IsTenantMember

from .models import AuditLog
from .serializers import AuditLogSerializer


class AuditLogViewSet(ReadOnlyModelViewSet):
    """Read-only :class:`AuditLog` + ``per_record`` filter action."""

    pagination_class = CRMCursorPagination
    serializer_class = AuditLogSerializer
    queryset = AuditLog.objects.select_related("tenant")
    permission_classes = [IsAuthenticated, IsTenantMember]

    @action(detail=False, methods=["get"], url_path="per-record")
    def per_record(self, request: Request) -> Response:
        """GET ``?target_type=...&target_id=...`` → audit rows for that target."""
        target_type = request.query_params.get("target_type", "")
        target_id = request.query_params.get("target_id", "")
        qs = (
            self.get_queryset()
            .filter(target_type=target_type, target_id=target_id)
            .order_by("-timestamp")
        )
        return Response(AuditLogSerializer(qs, many=True).data)


__all__ = ["AuditLogViewSet"]
