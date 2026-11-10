"""DRF ViewSets for the dashboards app.

* :class:`DashboardViewSet` — CRUD + ``render`` / ``templates`` /
  ``add_widget`` / ``export_pdf``.
* :class:`DashboardWidgetViewSet` — CRUD on individual widgets.
"""

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

from .filters import DashboardFilter, DashboardWidgetFilter
from .models import Dashboard, DashboardWidget
from .serializers import DashboardSerializer, DashboardWidgetSerializer
from .services import get_templates, render_dashboard


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve", "render", "templates", "export_pdf"):
        return [IsAuthenticated(), IsTenantMember()]
    return [IsAuthenticated(), IsTenantMember(), HasPermission("dashboards.manage")]


###############################################################################
# DashboardViewSet
###############################################################################


class DashboardViewSet(ModelViewSet):
    """CRUD + lifecycle actions on :class:`Dashboard`."""

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

    @action(detail=True, methods=["get"], url_path="render")
    def render(self, request: Request, pk: str | None = None) -> Response:
        """GET — hydrate every widget on this dashboard with its data."""
        dashboard: Dashboard = self.get_object()  # type: ignore[assignment]
        return Response(render_dashboard(dashboard))

    @action(detail=False, methods=["get"], url_path="templates")
    def templates(self, request: Request) -> Response:
        """GET — return the 5 pre-built dashboard templates."""
        return Response({"templates": get_templates()})

    @action(detail=True, methods=["post"], url_path="add_widget")
    def add_widget(self, request: Request, pk: str | None = None) -> Response:
        """POST a widget payload — creates a :class:`DashboardWidget`.

        Body: ``{title, widget_type, report?, position?, custom_config?, order?}``.
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
            position=serializer.validated_data.get("position", {}) or {},
            color_theme=serializer.validated_data.get("color_theme", "default"),
            drill_down=serializer.validated_data.get("drill_down"),
            custom_config=serializer.validated_data.get("custom_config", {}) or {},
            order=serializer.validated_data.get("order", 0) or 0,
        )
        return Response(
            DashboardWidgetSerializer(widget).data, status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=["get"], url_path="export_pdf")
    def export_pdf(self, request: Request, pk: str | None = None) -> Response:
        """GET — render the dashboard and return a stub PDF payload.

        The full PDF render pipeline (Playwright snapshot → PDF) is wired
        up on the frontend / async-worker side; this endpoint returns a
        JSON envelope containing the rendered widget data so a worker can
        snapshot it. Callers that want the binary should pass
        ``?accept=application/pdf`` (handled by the worker, not here).
        """
        dashboard: Dashboard = self.get_object()  # type: ignore[assignment]
        rendered = render_dashboard(dashboard)
        payload = {
            "dashboard_id": dashboard.pk,
            "dashboard_name": dashboard.name,
            "format": "pdf",
            "rendered_at": rendered.get("rendered_at"),
            "widgets": rendered["widgets"],
            "note": (
                "This endpoint returns the rendered widget payload. The actual "
                "PDF binary is produced by the async worker (Playwright snapshot)."
            ),
        }
        return Response(payload)


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
