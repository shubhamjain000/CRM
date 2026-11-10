"""Model-layer tests for the deal_prediction app."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from deal_prediction.models import MODEL_VERSION, PredictedDealValue


pytestmark = pytest.mark.django_db


def test_predicted_deal_value_defaults_and_str(active_tenant):  # type: ignore[no-untyped-def]
    pred = PredictedDealValue.objects.create(
        tenant=active_tenant,
        deal_id="7",
        expected_value=Decimal("5000"),
        close_probability=0.5,
        expected_close_date=date(2024, 12, 31),
    )
    assert pred.model_version == MODEL_VERSION
    assert "Deal 7" in str(pred)
    assert pred.close_probability == 0.5


def test_predicted_deal_value_unique_per_tenant_deal(active_tenant):  # type: ignore[no-untyped-def]
    PredictedDealValue.objects.create(tenant=active_tenant, deal_id="7")
    with pytest.raises(Exception):  # noqa: PT011
        PredictedDealValue.objects.create(tenant=active_tenant, deal_id="7")
