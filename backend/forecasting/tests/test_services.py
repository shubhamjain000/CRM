"""Service-layer tests for the forecasting app."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from deals.factories import DealFactory, StageFactory
from deals.models_pipeline import (
    FORECAST_CATEGORY_BEST_CASE,
    FORECAST_CATEGORY_CLOSED,
    FORECAST_CATEGORY_PIPELINE,
)
from forecasting.models import (
    CATEGORY_BEST_CASE,
    CATEGORY_CLOSED,
    CATEGORY_PIPELINE,
    Forecast,
    PERIOD_MONTHLY,
)
from forecasting.services import (
    approve_forecast,
    calculate_forecast,
    get_accuracy,
    get_scenarios,
    period_bounds,
    submit_forecast,
)


pytestmark = pytest.mark.django_db


def test_period_bounds_monthly():  # type: ignore[no-untyped-def]
    start, end = period_bounds("monthly", date(2024, 3, 15))
    assert start == date(2024, 3, 1)
    assert end == date(2024, 3, 31)


def test_period_bounds_quarterly():  # type: ignore[no-untyped-def]
    start, end = period_bounds("quarterly", date(2024, 5, 10))
    assert start == date(2024, 4, 1)
    assert end == date(2024, 6, 30)


def test_calculate_forecast_sums_matching_deals(active_tenant, user):  # type: ignore[no-untyped-def]
    stage = StageFactory(
        tenant=active_tenant, forecast_category=FORECAST_CATEGORY_PIPELINE
    )
    # In-window deal.
    DealFactory(
        tenant=active_tenant,
        owner=user,
        stage=stage,
        forecast_category=CATEGORY_PIPELINE,
        amount=Decimal("1000"),
        close_date=date(2024, 3, 10),
    )
    # Out-of-window deal (excluded).
    DealFactory(
        tenant=active_tenant,
        owner=user,
        stage=stage,
        forecast_category=CATEGORY_PIPELINE,
        amount=Decimal("5000"),
        close_date=date(2024, 5, 10),
    )
    total = calculate_forecast(user, "monthly", date(2024, 3, 15), tenant=active_tenant)
    assert total == Decimal("1000")


def test_submit_and_approve_stamps_timestamps(active_tenant, user):  # type: ignore[no-untyped-def]
    from forecasting.factories import ForecastFactory  # noqa: PLC0415

    fc = ForecastFactory(tenant=active_tenant, user=user)
    assert fc.submitted_at is None
    submit_forecast(fc)
    fc.refresh_from_db()
    assert fc.submitted_at is not None

    approve_forecast(fc, user)
    fc.refresh_from_db()
    assert fc.approved_by_id == user.pk
    assert fc.approved_at is not None


def test_get_scenarios_best_worst_most_likely(active_tenant, user):  # type: ignore[no-untyped-def]
    stage = StageFactory(tenant=active_tenant, forecast_category=FORECAST_CATEGORY_PIPELINE)
    DealFactory(
        tenant=active_tenant, owner=user, stage=stage,
        amount=Decimal("1000"), probability=50.0, close_date=date(2024, 3, 5),
    )
    DealFactory(
        tenant=active_tenant, owner=user, stage=stage,
        amount=Decimal("2000"), probability=90.0, close_date=date(2024, 3, 15),
    )
    scenarios = get_scenarios(user, "monthly", date(2024, 3, 1), tenant=active_tenant)
    # best = 1000 + 2000 = 3000; worst (prob>=75) = 2000; most_likely = 1000*0.5 + 2000*0.9 = 2300
    assert Decimal(scenarios["best"]) == Decimal("3000")
    assert Decimal(scenarios["worst"]) == Decimal("2000")
    assert Decimal(scenarios["most_likely"]) == Decimal("2300.0")


def test_get_accuracy_returns_periods_back(active_tenant, user):  # type: ignore[no-untyped-def]
    # No forecasts exist → all accuracies should be 100.0 (both zero).
    result = get_accuracy(user, periods_back=3)
    assert len(result["periods"]) == 3
    assert result["average_accuracy_pct"] == 100.0
