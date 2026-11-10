"""DRF ViewSets for the security_monitoring app.

* :class:`SecurityEventViewSet` — read-only list / retrieve +
  ``acknowledge`` action that upserts the linked :class:`SecurityAlert`
  to ``acknowledged`` status with ``acknowledged_by=request.user``
  (gated by ``security_monitoring.manage``).
* :class:`SecurityAlertViewSet` — read-only list / retrieve over the
  derived alert table.
"""

from __future__ import annotations

from typing import Any

from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ReadOnlyModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember

from .models import ALERT_ACKNOWLEDGED, SecurityAlert, SecurityEvent
from .serializers import SecurityAlertSerializer, SecurityEventSerializer


class SecurityEventViewSet(ReadOnlyModelViewSet):
    """Read-only :class:`SecurityEvent` + ``acknowledge`` action."""

    pagination_class = CRMCursorPagination
    serializer_class = SecurityEventSerializer
    queryset = SecurityEvent.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        if self.action == "acknowledge":
            return [
                IsAuthenticated(),
                IsTenantMember(),
                HasPermission("security_monitoring.manage"),
            ]
        return [IsAuthenticated(), IsTenantMember()]

    @action(detail=True, methods=["post"], url_path="acknowledge")
    def acknowledge(self, request: Request, pk: str | None = None) -> Response:
        """POST — flip the linked :class:`SecurityAlert` to ``acknowledged``.

        Creates the alert row on demand if it does not yet exist.
        Returns the serialized alert.
        """
        event: SecurityEvent = self.get_object()  # type: ignore[assignment]
        alert, _created = SecurityAlert.objects.get_or_create(
            tenant=request.tenant,  # type: ignore[attr-defined]
            event=event,
            defaults={
                "status": ALERT_ACKNOWLEDGED,
                "acknowledged_by": request.user,
            },
        )
        if alert.status != ALERT_ACKNOWLEDGED:
            alert.status = ALERT_ACKNOWLEDGED
            alert.acknowledged_by = request.user
            alert.save(update_fields=["status", "acknowledged_by", "updated_at"])
        return Response(SecurityAlertSerializer(alert).data)


class SecurityAlertViewSet(ReadOnlyModelViewSet):
    """Read-only list / retrieve over :class:`SecurityAlert`."""

    pagination_class = CRMCursorPagination
    serializer_class = SecurityAlertSerializer
    queryset = SecurityAlert.objects.select_related(
        "tenant", "event", "acknowledged_by"
    )
    permission_classes = [IsAuthenticated, IsTenantMember]


__all__ = ["SecurityEventViewSet", "SecurityAlertViewSet"]
