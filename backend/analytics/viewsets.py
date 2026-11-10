"""DRF ViewSets for the analytics app.

* :class:`DashboardViewSet` — CRUD + ``add_widget`` / ``remove_widget`` /
  ``render`` (hydrates every widget with data).
* :class:`DashboardWidgetViewSet` — CRUD on individual widgets.
"""

from __future__ import annotations

import logging
from typing import Any

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from analytics.filters import DashboardFilter, DashboardWidgetFilter
from analytics.models import Dashboard, DashboardWidget
from analytics.serializers import DashboardSerializer, DashboardWidgetSerializer
from analytics.services import compute, list_available, render_dashboard
from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember

log = logging.getLogger(__name__)


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve", "render", "compute", "available"):
        return [IsAuthenticated(), IsTenantMember()]
    return [IsAuthenticated(), IsTenantMember(), HasPermission("analytics.manage")]


###############################################################################
# DashboardViewSet
###############################################################################


class DashboardViewSet(ModelViewSet):
    """CRUD + widget-management actions on :class:`Dashboard`."""

    pagination_class = CRMCursorPagination
    serializer_class = DashboardSerializer
    filterset_class = DashboardFilter
    queryset = Dashboard.objects.select_related("tenant", "created_by")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: DashboardSerializer
    ) -> None:
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant, created_by=self.request.user
        )

    @action(detail=True, methods=["post"], url_path="add_widget")
    def add_widget(self, request: Request, pk: str | None = None) -> Response:
        """POST a widget payload — creates a :class:`DashboardWidget`.

        Body: ``{title, widget_type, report?, config?, order?}``.
        """
        dashboard: Dashboard = self.get_object()  # type: ignore[assignment]
        serializer = DashboardWidgetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        widget = DashboardWidget.objects.create(
            tenant=dashboard.tenant,
            dashboard=dashboard,
            title=serializer.validated_data.get("title", ""),
            widget_type=serializer.validated_data.get("widget_type", "chart"),
            report=serializer.validated_data.get("report"),
            config=serializer.validated_data.get("config", {}) or {},
            order=serializer.validated_data.get("order", 0) or 0,
        )
        return Response(DashboardWidgetSerializer(widget).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="remove_widget")
    def remove_widget(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{widget_id}`` — detach (delete) a widget from the dashboard."""
        dashboard: Dashboard = self.get_object()  # type: ignore[assignment]
        widget_id = request.data.get("widget_id")
        if not widget_id:
            return Response(
                {"detail": "widget_id is required."}, status=status.HTTP_400_BAD_REQUEST
            )
        deleted, _ = DashboardWidget.objects.filter(
            pk=widget_id, dashboard=dashboard
        ).delete()
        if not deleted:
            return Response(
                {"detail": "Widget not found on this dashboard."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get"], url_path="render")
    def render(self, request: Request, pk: str | None = None) -> Response:
        """GET — hydrate every widget on this dashboard with its data."""
        dashboard: Dashboard = self.get_object()  # type: ignore[assignment]
        return Response(render_dashboard(dashboard.pk))

    @action(detail=False, methods=["get"], url_path="available")
    def available(self, request: Request) -> Response:
        """GET — list every available pre-built analytics dataset name."""
        return Response({"data_sources": list_available()})

    @action(detail=False, methods=["get"], url_path="compute")
    def compute_action(self, request: Request) -> Response:
        """GET ``?data_source=sales_funnel&...`` — compute a pre-built dataset.

        Extra query params are forwarded as kwargs to the underlying
        analytics function (e.g. ``&group_by=source``).
        """
        data_source = request.query_params.get("data_source")
        if not data_source:
            return Response(
                {"detail": "data_source query param is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        kwargs = {
            k: v
            for k, v in request.query_params.items()
            if k not in ("data_source",)
        }
        try:
            result = compute(data_source, tenant=request.tenant, **kwargs)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:  # pragma: no cover — defensive
            log.exception("compute: data_source=%s failed", data_source)
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result)


###############################################################################
# DashboardWidgetViewSet
###############################################################################


class DashboardWidgetViewSet(ModelViewSet):
    """CRUD on :class:`DashboardWidget`."""

    pagination_class = CRMCursorPagination
    serializer_class = DashboardWidgetSerializer
    filterset_class = DashboardWidgetFilter
    queryset = DashboardWidget.objects.select_related("tenant", "dashboard", "report")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: DashboardWidgetSerializer
    ) -> None:
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant
        )


__all__ = ["DashboardViewSet", "DashboardWidgetViewSet"]
