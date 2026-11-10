"""URL routes for the dashboards app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import DashboardViewSet, DashboardWidgetViewSet

router = DefaultRouter()
router.register(r"dashboards", DashboardViewSet, basename="dashboard_v2")
router.register(r"dashboard-widgets", DashboardWidgetViewSet, basename="dashboardwidget_v2")

urlpatterns: list = list(router.urls)
