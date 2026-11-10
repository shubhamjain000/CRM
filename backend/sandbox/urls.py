"""URL routes for the sandbox app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import SandboxViewSet

router = DefaultRouter()
router.register(r"sandboxes", SandboxViewSet, basename="sandbox")

urlpatterns: list = list(router.urls)
