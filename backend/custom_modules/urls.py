"""URL routes for the custom_modules app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import (
    CustomModuleFieldViewSet,
    CustomModuleRecordViewSet,
    CustomModuleViewSet,
)

router = DefaultRouter()
router.register(r"custom-modules", CustomModuleViewSet, basename="custommodule")
router.register(
    r"custom-module-fields", CustomModuleFieldViewSet, basename="custommodulefield"
)
router.register(
    r"custom-module-records", CustomModuleRecordViewSet, basename="custommodulerecord"
)

urlpatterns: list = list(router.urls)
