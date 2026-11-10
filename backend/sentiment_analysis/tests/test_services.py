"""Service-layer tests for the sentiment_analysis app."""

from __future__ import annotations

from sentiment_analysis.services import analyze_record, analyze_text, get_heatmap, get_trend


pytestmark = pytest.mark.django_db


def test_analyze_text_positive_vs_negative():  # type: ignore[no-untyped-def]
    pos = analyze_text("This is great and wonderful, I love it!")
    assert pos["sentiment"] > 0
    assert pos["confidence"] > 0
    neg = analyze_text("This is awful and terrible, I hate it.")
    assert neg["sentiment"] < 0
    neutral = analyze_text("The report arrived on Tuesday.")
    assert neutral["sentiment"] == 0.0
    assert neutral["confidence"] == 0.0


def test_analyze_record_persists_and_trend_returns_chronological(active_tenant):  # type: ignore[no-untyped-def]
    a = analyze_record("email", "42", text="Great, thanks!", tenant=active_tenant)
    b = analyze_record("email", "42", text="This is awful.", tenant=active_tenant)
    trend = get_trend("email", "42", tenant=active_tenant)
    assert len(trend) == 2
    assert trend[0].pk == a.pk  # oldest first
    assert trend[-1].pk == b.pk
    heatmap = get_heatmap(tenant=active_tenant, days=30)
    assert "email" in heatmap
