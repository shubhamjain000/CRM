"""Model-layer tests for the ai_writer app."""

from __future__ import annotations

import pytest

from ai_writer.models import (
    AIWriterDraft,
    DRAFT_EMAIL,
    DRAFT_PROPOSAL,
    DRAFT_SUMMARY,
)


pytestmark = pytest.mark.django_db


def test_draft_defaults_and_str(active_tenant, user):  # type: ignore[no-untyped-def]
    draft = AIWriterDraft.objects.create(
        tenant=active_tenant, user=user,
        draft_type=DRAFT_EMAIL, prompt="Cold intro to Acme",
        generated_content="Subject: Hi",
    )
    assert draft.style == "professional"
    assert draft.tone == "friendly"
    assert "Cold intro" in str(draft)


def test_draft_supports_multiple_types_per_user(active_tenant, user):  # type: ignore[no-untyped-def]
    AIWriterDraft.objects.create(
        tenant=active_tenant, user=user, draft_type=DRAFT_EMAIL, prompt="a",
    )
    AIWriterDraft.objects.create(
        tenant=active_tenant, user=user, draft_type=DRAFT_SUMMARY, prompt="b",
    )
    AIWriterDraft.objects.create(
        tenant=active_tenant, user=user, draft_type=DRAFT_PROPOSAL, prompt="c",
    )
    assert AIWriterDraft.objects.filter(user=user).count() == 3
