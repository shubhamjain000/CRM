"""URL routes for the native_integrations app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import IntegrationViewSet

router = DefaultRouter()
router.register(r"integrations", IntegrationViewSet, basename="integration")

urlpatterns: list = list(router.urls)
