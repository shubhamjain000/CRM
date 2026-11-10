"""URL routes for the events app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from events.views import EventViewSet

router = DefaultRouter()
router.register(r"events", EventViewSet, basename="event")

urlpatterns = router.urls
