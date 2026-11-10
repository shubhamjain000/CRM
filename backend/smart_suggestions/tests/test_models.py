"""Model-layer tests for the smart_suggestions app."""

from __future__ import annotations

import pytest

from smart_suggestions.models import (
    TYPE_CHURN_RISK,
    TYPE_NEXT_BEST_ACTION,
    SmartSuggestion,
)


pytestmark = pytest.mark.django_db


def test_suggestion_defaults_and_str(active_tenant, user):  # type: ignore[no-untyped-def]
    s = SmartSuggestion.objects.create(
        tenant=active_tenant, user=user,
        suggestion_type=TYPE_NEXT_BEST_ACTION, title="Call Jane", priority=80,
    )
    assert s.is_dismissed is False
    assert s.is_accepted is False
    assert "Call Jane" in str(s)


def test_suggestion_lifecycle_flags_independent(active_tenant, user):  # type: ignore[no-untyped-def]
    s = SmartSuggestion.objects.create(
        tenant=active_tenant, user=user,
        suggestion_type=TYPE_CHURN_RISK, title="x",
    )
    s.is_accepted = True
    s.save()
    s.refresh_from_db()
    assert s.is_accepted is True
    assert s.is_dismissed is False
