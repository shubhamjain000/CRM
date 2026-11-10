"""URL routes for the data_security app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import DataClassificationViewSet, RetentionPolicyViewSet

router = DefaultRouter()
router.register(
    r"data-classifications",
    DataClassificationViewSet,
    basename="data-classification",
)
router.register(
    r"retention-policies", RetentionPolicyViewSet, basename="retention-policy"
)

urlpatterns: list = list(router.urls)
