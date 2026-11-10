"""URL routes for the layouts app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import LayoutSectionViewSet, LayoutViewSet

router = DefaultRouter()
router.register(r"layouts", LayoutViewSet, basename="layout")
router.register(r"layout-sections", LayoutSectionViewSet, basename="layoutsection")

urlpatterns: list = list(router.urls)
