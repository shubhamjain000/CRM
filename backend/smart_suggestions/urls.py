"""URL routes for the smart_suggestions app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import SmartSuggestionViewSet

router = DefaultRouter()
router.register(
    r"smart-suggestions", SmartSuggestionViewSet, basename="smartsuggestion"
)

urlpatterns: list = list(router.urls)
