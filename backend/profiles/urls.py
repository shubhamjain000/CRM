"""URL routes for the profiles app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import (
    FieldPermissionViewSet,
    ProfilePermissionViewSet,
    ProfileViewSet,
)

router = DefaultRouter()
router.register(r"profiles", ProfileViewSet, basename="profile")
router.register(
    r"profile-permissions", ProfilePermissionViewSet, basename="profilepermission"
)
router.register(
    r"field-permissions", FieldPermissionViewSet, basename="fieldpermission"
)

urlpatterns: list = list(router.urls)
