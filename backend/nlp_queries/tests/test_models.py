"""Model-layer tests for the nlp_queries app."""

from __future__ import annotations

import pytest

from nlp_queries.models import NLPQuery


pytestmark = pytest.mark.django_db


def test_nlpquery_defaults_and_str(active_tenant, user):  # type: ignore[no-untyped-def]
    q = NLPQuery.objects.create(
        tenant=active_tenant, user=user,
        question="deals closing this month",
        generated_spec={"model": "deal"},
    )
    assert q.result_summary == ""
    assert "deals closing" in str(q)
    assert q.generated_spec == {"model": "deal"}


def test_nlpquery_supports_multiple_per_user(active_tenant, user):  # type: ignore[no-untyped-def]
    NLPQuery.objects.create(tenant=active_tenant, user=user, question="a")
    NLPQuery.objects.create(tenant=active_tenant, user=user, question="b")
    assert NLPQuery.objects.filter(user=user).count() == 2
