"""URL routes for the deal_prediction app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import PredictedDealValueViewSet

router = DefaultRouter()
router.register(
    r"predicted-deal-values", PredictedDealValueViewSet, basename="predicteddealvalue"
)

urlpatterns: list = list(router.urls)
