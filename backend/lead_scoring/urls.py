"""URL routes for the lead_scoring app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import LeadScoreViewSet

router = DefaultRouter()
router.register(r"lead-scores", LeadScoreViewSet, basename="leadscore")

urlpatterns: list = list(router.urls)
