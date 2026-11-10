"""Model-layer tests for the sentiment_analysis app."""

from __future__ import annotations

import pytest

from sentiment_analysis.models import MODEL_VERSION, Sentiment


pytestmark = pytest.mark.django_db


def test_sentiment_defaults_and_str(active_tenant):  # type: ignore[no-untyped-def]
    sent = Sentiment.objects.create(
        tenant=active_tenant,
        record_module="email",
        record_id="42",
        sentiment=0.75,
        confidence=0.9,
    )
    assert sent.model_version == MODEL_VERSION
    assert "email:42" in str(sent)
    assert sent.sentiment == 0.75


def test_sentiment_supports_multiple_rows_per_record(active_tenant):  # type: ignore[no-untyped-def]
    Sentiment.objects.create(
        tenant=active_tenant, record_module="email", record_id="42", sentiment=0.5,
    )
    Sentiment.objects.create(
        tenant=active_tenant, record_module="email", record_id="42", sentiment=-0.25,
    )
    assert Sentiment.objects.filter(tenant=active_tenant).count() == 2
