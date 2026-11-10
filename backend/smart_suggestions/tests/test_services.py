"""Service-layer tests for the smart_suggestions app."""

from __future__ import annotations

from smart_suggestions.models import SmartSuggestion, TYPE_NEXT_BEST_ACTION
from smart_suggestions.services import (
    accept_suggestion,
    dismiss_suggestion,
    generate_suggestions,
)


pytestmark = pytest.mark.django_db


def test_generate_suggestions_with_no_crm_data_returns_zero(active_tenant, user):  # type: ignore[no-untyped-def]
    result = generate_suggestions(user)
    assert result == {"created": 0}


def test_accept_and_dismiss_suggestion_lifecycle(active_tenant, user):  # type: ignore[no-untyped-def]
    s = SmartSuggestion.objects.create(
        tenant=active_tenant, user=user,
        suggestion_type=TYPE_NEXT_BEST_ACTION, title="x",
    )
    accepted = accept_suggestion(s.pk, user=user)
    assert accepted.is_accepted is True
    assert accepted.is_dismissed is False
    dismissed = dismiss_suggestion(s.pk, user=user)
    assert dismissed.is_dismissed is True
