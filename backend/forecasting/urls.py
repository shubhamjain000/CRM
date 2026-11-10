"""URL routes for the forecasting app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import ForecastAdjustmentViewSet, ForecastViewSet

router = DefaultRouter()
router.register(r"forecasts", ForecastViewSet, basename="forecast")
router.register(
    r"forecast-adjustments", ForecastAdjustmentViewSet, basename="forecastadjustment"
)

urlpatterns: list = list(router.urls)
