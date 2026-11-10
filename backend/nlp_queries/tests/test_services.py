"""Service-layer tests for the nlp_queries app."""

from __future__ import annotations

from nlp_queries.services import execute_query, parse_query


pytestmark = pytest.mark.django_db


def test_parse_query_deals_closing_this_month():  # type: ignore[no-untyped-def]
    spec = parse_query("Show me deals closing this month")
    assert spec["model"] == "deal"
    assert spec["filters"]["close_date"] == "this_month"
    assert spec["period"] == "this_month"


def test_parse_query_open_leads_fallbacks():  # type: ignore[no-untyped-def]
    spec = parse_query("open leads")
    assert spec["model"] == "lead"
    assert spec["filters"]["status"] == "open"


def test_execute_query_unknown_model_returns_zero(active_tenant):  # type: ignore[no-untyped-def]
    result = execute_query({"model": "unknown", "filters": {}}, tenant=active_tenant)
    assert result["count"] == 0
    assert "Unknown model" in result["summary"]
