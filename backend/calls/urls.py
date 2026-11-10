"""URL routes for the calls app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from calls.views import CallViewSet

router = DefaultRouter()
router.register(r"calls", CallViewSet, basename="call")

urlpatterns = router.urls
