"""factory_boy factories for the forecasting app."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import factory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant, _current_user

from .models import (
    CATEGORY_BEST_CASE,
    CATEGORY_COMMIT,
    Forecast,
    ForecastAdjustment,
    PERIOD_MONTHLY,
)


class ForecastFactory(DjangoModelFactory):
    """Factory for :class:`Forecast`."""

    class Meta:
        model = Forecast

    tenant = factory.LazyFunction(_current_tenant)
    user = factory.LazyFunction(_current_user)
    period_type = PERIOD_MONTHLY
    period_start = factory.LazyFunction(lambda: date.today().replace(day=1))
    period_end = factory.LazyAttribute(
        lambda obj: (obj.period_start.replace(day=28) + timedelta(days=4))
        .replace(day=1)
        - timedelta(days=1)
    )
    category = CATEGORY_BEST_CASE
    amount = Decimal("10000.00")
    override_amount = None
    notes = ""
    submitted_at = None
    approved_by = None
    approved_at = None


class ForecastAdjustmentFactory(DjangoModelFactory):
    """Factory for :class:`ForecastAdjustment`."""

    class Meta:
        model = ForecastAdjustment

    tenant = factory.LazyFunction(_current_tenant)
    forecast = factory.SubFactory(ForecastFactory, category=CATEGORY_COMMIT)
    adjusted_by = factory.LazyFunction(_current_user)
    old_amount = Decimal("5000.00")
    new_amount = Decimal("8000.00")
    reason = factory.Faker("sentence")


__all__ = ["ForecastAdjustmentFactory", "ForecastFactory"]
