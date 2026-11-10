"""URL routes for the access_control app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import (
    IPAllowlistViewSet,
    SessionPolicyViewSet,
    TrustedDeviceViewSet,
)

router = DefaultRouter()
router.register(r"ip-allowlists", IPAllowlistViewSet, basename="ip-allowlist")
router.register(r"session-policies", SessionPolicyViewSet, basename="session-policy")
router.register(r"trusted-devices", TrustedDeviceViewSet, basename="trusted-device")

urlpatterns: list = list(router.urls)
