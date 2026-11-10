"""Service-layer tests for the lead_scoring app."""

from __future__ import annotations

from lead_scoring.models import LeadScore
from lead_scoring.services import (
    HOT_LEAD_THRESHOLD,
    compute_factors,
    get_hot_leads,
    score_from_factors,
    score_lead,
)


pytestmark = pytest.mark.django_db


def test_compute_factors_caps_at_100(active_tenant):  # type: ignore[no-untyped-def]
    factors = compute_factors(
        {
            "email": "jane@acme.com",
            "phone": "+1-555-0100",
            "company": "Acme",
            "annual_revenue": 20_000_000,
            "source": "partner",
        }
    )
    assert factors == {
        "has_email": 5,
        "has_phone": 5,
        "company_match": 20,
        "revenue_tier": 30,
        "source_weight": 20,
    }
    assert score_from_factors(factors) == 80


def test_score_lead_persists_row_when_lead_missing(active_tenant):  # type: ignore[no-untyped-def]
    score = score_lead("does-not-exist", tenant=active_tenant)
    assert score.score == 0
    assert score.tenant_id == active_tenant.pk
    # get_hot_leads should not return the 0-score row.
    assert get_hot_leads(tenant=active_tenant) == []
    # Force it over the threshold and confirm get_hot_leads returns it.
    score.score = HOT_LEAD_THRESHOLD + 1
    score.save()
    assert len(get_hot_leads(tenant=active_tenant)) == 1
    assert LeadScore.objects.filter(tenant=active_tenant).count() == 1
