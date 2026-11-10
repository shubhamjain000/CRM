"""Model-layer tests for the forecasting app."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from forecasting.factories import ForecastAdjustmentFactory, ForecastFactory
from forecasting.models import (
    CATEGORY_BEST_CASE,
    CATEGORY_COMMIT,
    Forecast,
    ForecastAdjustment,
    PERIOD_MONTHLY,
)


pytestmark = pytest.mark.django_db


def test_forecast_defaults_and_str(active_tenant, user):  # type: ignore[no-untyped-def]
    fc = ForecastFactory(tenant=active_tenant, user=user, category=CATEGORY_BEST_CASE)
    assert fc.period_type == PERIOD_MONTHLY
    assert fc.override_amount is None
    assert fc.submitted_at is None
    assert str(fc).startswith(f"{user.pk} / monthly")


def test_forecast_effective_amount_uses_override(active_tenant, user):  # type: ignore[no-untyped-def]
    fc = ForecastFactory(
        tenant=active_tenant, user=user, amount=Decimal("1000"), override_amount=Decimal("2000")
    )
    assert fc.effective_amount == Decimal("2000")

    fc2 = ForecastFactory(
        tenant=active_tenant, user=user, amount=Decimal("3000"), override_amount=None
    )
    assert fc2.effective_amount == Decimal("3000")


def test_forecast_adjustment_str(active_tenant, user):  # type: ignore[no-untyped-def]
    fc = ForecastFactory(tenant=active_tenant, user=user)
    adj = ForecastAdjustmentFactory(
        tenant=active_tenant, forecast=fc, old_amount=Decimal("100"), new_amount=Decimal("200")
    )
    assert "100" in str(adj) and "200" in str(adj)
    assert adj.forecast_id == fc.pk


def test_forecast_cascade_deletes_adjustments(active_tenant, user):  # type: ignore[no-untyped-def]
    fc = ForecastFactory(tenant=active_tenant, user=user)
    ForecastAdjustmentFactory(tenant=active_tenant, forecast=fc)
    ForecastAdjustmentFactory(tenant=active_tenant, forecast=fc)
    assert ForecastAdjustment.objects.filter(forecast=fc).count() == 2
    fc_pk = fc.pk
    fc.delete()
    assert ForecastAdjustment.objects.filter(forecast_id=fc_pk).count() == 0
