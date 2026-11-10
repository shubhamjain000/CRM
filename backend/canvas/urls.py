"""URL routes for the canvas app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import CanvasThemeViewSet

router = DefaultRouter()
router.register(r"canvas-themes", CanvasThemeViewSet, basename="canvastheme")

urlpatterns: list = list(router.urls)
