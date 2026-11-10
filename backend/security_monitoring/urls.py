"""URL routes for the security_monitoring app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import SecurityAlertViewSet, SecurityEventViewSet

router = DefaultRouter()
router.register(
    r"security-events", SecurityEventViewSet, basename="security-event"
)
router.register(
    r"security-alerts", SecurityAlertViewSet, basename="security-alert"
)

urlpatterns: list = list(router.urls)
