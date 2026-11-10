"""URL routes for the notifications app.

All routes mount under ``/api/v1/`` (see ``config/urls.py``).
"""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import (
    NotificationPreferenceViewSet,
    NotificationViewSet,
    QuietHoursViewSet,
)

router = DefaultRouter()
router.register(r"notifications", NotificationViewSet, basename="notification")
router.register(
    r"notification-preferences",
    NotificationPreferenceViewSet,
    basename="notification-preference",
)
router.register(r"quiet-hours", QuietHoursViewSet, basename="quiet-hours")

urlpatterns = router.urls
