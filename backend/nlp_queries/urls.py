"""URL routes for the nlp_queries app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import NLPQueryViewSet

router = DefaultRouter()
router.register(r"nlp-queries", NLPQueryViewSet, basename="nlpquery")

urlpatterns: list = list(router.urls)
