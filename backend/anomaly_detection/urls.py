"""URL routes for the anomaly_detection app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import AnomalyViewSet

router = DefaultRouter()
router.register(r"anomalies", AnomalyViewSet, basename="anomaly")

urlpatterns: list = list(router.urls)
