"""URL routes for the analytics app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from analytics.viewsets import DashboardViewSet, DashboardWidgetViewSet

router = DefaultRouter()
router.register(r"dashboards", DashboardViewSet, basename="dashboard")
router.register(r"dashboard-widgets", DashboardWidgetViewSet, basename="dashboardwidget")

urlpatterns: list = list(router.urls)
