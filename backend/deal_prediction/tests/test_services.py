"""Service-layer tests for the deal_prediction app."""

from __future__ import annotations

from deal_prediction.models import PredictedDealValue
from deal_prediction.services import get_at_risk, predict_deal


pytestmark = pytest.mark.django_db


def test_predict_deal_with_missing_deal_records_zero(active_tenant):  # type: ignore[no-untyped-def]
    pred = predict_deal("does-not-exist", tenant=active_tenant)
    assert pred.close_probability == 0.5  # stage=None defaults to 0.5
    assert pred.expected_value == 0
    # Second call stashes previous_probability inside factors.
    pred2 = predict_deal("does-not-exist", tenant=active_tenant)
    assert pred2.factors["previous_probability"] == 0.5


def test_get_at_risk_detects_probability_drop(active_tenant):  # type: ignore[no-untyped-def]
    # First prediction at 0.6 probability.
    predict_deal("d1", tenant=active_tenant)
    # Force the second prediction's prior to a high value, then drop.
    row = PredictedDealValue.objects.get(tenant=active_tenant, deal_id="d1")
    row.close_probability = 0.6
    row.factors = {"previous_probability": 0.8}
    row.save()
    # previous_probability=0.8 → current=0.6 is a 0.2 drop = 25% (above 20%).
    at_risk = get_at_risk(tenant=active_tenant)
    assert any(r.deal_id == "d1" for r in at_risk)
