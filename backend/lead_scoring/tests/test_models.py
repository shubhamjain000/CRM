"""Model-layer tests for the lead_scoring app."""

from __future__ import annotations

import pytest

from lead_scoring.models import MODEL_VERSION, LeadScore


pytestmark = pytest.mark.django_db


def test_leadscore_defaults_and_str(active_tenant):  # type: ignore[no-untyped-def]
    score = LeadScore.objects.create(
        tenant=active_tenant, lead_id="42", score=72,
        factors={"has_email": 5},
    )
    assert score.model_version == MODEL_VERSION
    assert str(score) == "Lead 42 → 72"
    assert score.factors == {"has_email": 5}


def test_leadscore_unique_per_tenant_lead(active_tenant):  # type: ignore[no-untyped-def]
    LeadScore.objects.create(tenant=active_tenant, lead_id="42", score=10)
    with pytest.raises(Exception):  # noqa: PT011
        LeadScore.objects.create(tenant=active_tenant, lead_id="42", score=20)
