"""URL routes for the marketplace app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import ExtensionViewSet, InstalledExtensionViewSet

router = DefaultRouter()
router.register(r"extensions", ExtensionViewSet, basename="extension")
router.register(
    r"installed-extensions", InstalledExtensionViewSet, basename="installedextension"
)

urlpatterns: list = list(router.urls)
