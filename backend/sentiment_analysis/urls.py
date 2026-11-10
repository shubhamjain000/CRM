"""URL routes for the sentiment_analysis app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import SentimentViewSet

router = DefaultRouter()
router.register(r"sentiments", SentimentViewSet, basename="sentiment")

urlpatterns: list = list(router.urls)
