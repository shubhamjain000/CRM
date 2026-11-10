"""django-filter FilterSets for the forecasting app."""

from __future__ import annotations

import django_filters

from .models import Forecast, ForecastAdjustment


class ForecastFilter(django_filters.FilterSet):
    """Filter forecasts by user / period / category / submission state."""

    user = django_filters.NumberFilter(field_name="user_id")
    period_type = django_filters.CharFilter(field_name="period_type")
    category = django_filters.CharFilter(field_name="category")
    period_start = django_filters.DateFilter(field_name="period_start")
    period_start__gte = django_filters.DateFilter(field_name="period_start", lookup_expr="gte")
    period_start__lte = django_filters.DateFilter(field_name="period_start", lookup_expr="lte")
    is_submitted = django_filters.BooleanFilter(
        method="_filter_submitted", label="Submitted (true/false)"
    )
    is_approved = django_filters.BooleanFilter(
        method="_filter_approved", label="Approved (true/false)"
    )

    class Meta:
        model = Forecast
        fields: list[str] = []

    def _filter_submitted(self, queryset, name, value):  # type: ignore[no-untyped-def]
        return queryset.filter(submitted_at__isnull=not value)

    def _filter_approved(self, queryset, name, value):  # type: ignore[no-untyped-def]
        return queryset.filter(approved_at__isnull=not value)


class ForecastAdjustmentFilter(django_filters.FilterSet):
    """Filter adjustments by forecast / adjuster."""

    forecast = django_filters.NumberFilter(field_name="forecast_id")
    adjusted_by = django_filters.NumberFilter(field_name="adjusted_by_id")

    class Meta:
        model = ForecastAdjustment
        fields: list[str] = []
