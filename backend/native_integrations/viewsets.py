"""DRF ViewSets for the native_integrations app.

* :class:`IntegrationViewSet` — CRUD + ``connect`` + ``disconnect`` +
  ``sync`` + ``logs`` (read-only list of logs for the integration).
"""

from __future__ import annotations

from typing import Any

from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember

from .models import Integration, IntegrationLog, LOG_INFO, LOG_OK
from .serializers import IntegrationLogSerializer, IntegrationSerializer


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve", "logs"):
        return [IsAuthenticated(), IsTenantMember()]
    return [
        IsAuthenticated(),
        IsTenantMember(),
        HasPermission("native_integrations.manage"),
    ]


def _write_log(
    *, tenant: Any, integration: Integration, event: str, st: str, details: dict[str, Any]
) -> IntegrationLog:
    return IntegrationLog.objects.create(
        tenant=tenant, integration=integration, event=event, status=st, details=details
    )


class IntegrationViewSet(ModelViewSet):
    """CRUD on :class:`Integration` + ``connect`` / ``disconnect`` /
    ``sync`` / ``logs``."""

    pagination_class = CRMCursorPagination
    serializer_class = IntegrationSerializer
    queryset = Integration.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(self, serializer: IntegrationSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    @action(detail=True, methods=["post"], url_path="connect")
    def connect(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{config?}`` — mark the integration as connected."""
        integration: Integration = self.get_object()  # type: ignore[assignment]
        config = request.data.get("config")
        if config:
            integration.config = config
        integration.is_connected = True
        integration.last_synced_at = timezone.now()
        integration.save(update_fields=["config", "is_connected", "last_synced_at", "updated_at"])
        _write_log(
            tenant=request.tenant,
            integration=integration,
            event="connect",
            st=LOG_OK,
            details={"config_keys": list(integration.config.keys()) if integration.config else []},
        )
        return Response(IntegrationSerializer(integration).data)

    @action(detail=True, methods=["post"], url_path="disconnect")
    def disconnect(self, request: Request, pk: str | None = None) -> Response:
        """POST — mark the integration as disconnected."""
        integration: Integration = self.get_object()  # type: ignore[assignment]
        integration.is_connected = False
        integration.save(update_fields=["is_connected", "updated_at"])
        _write_log(
            tenant=request.tenant,
            integration=integration,
            event="disconnect",
            st=LOG_INFO,
            details={},
        )
        return Response(IntegrationSerializer(integration).data)

    @action(detail=True, methods=["post"], url_path="sync")
    def sync(self, request: Request, pk: str | None = None) -> Response:
        """POST — record a sync event + update ``last_synced_at``."""
        integration: Integration = self.get_object()  # type: ignore[assignment]
        if not integration.is_connected:
            return Response(
                {"detail": "Integration is not connected."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        integration.last_synced_at = timezone.now()
        integration.save(update_fields=["last_synced_at", "updated_at"])
        _write_log(
            tenant=request.tenant,
            integration=integration,
            event="sync",
            st=LOG_OK,
            details={"summary": "ok"},
        )
        return Response(IntegrationSerializer(integration).data)

    @action(detail=True, methods=["get"], url_path="logs")
    def logs(self, request: Request, pk: str | None = None) -> Response:
        """GET — append-only event log for this integration."""
        integration: Integration = self.get_object()  # type: ignore[assignment]
        qs = integration.logs.order_by("-created_at")
        return Response(IntegrationLogSerializer(qs, many=True).data)


__all__ = ["IntegrationViewSet"]
