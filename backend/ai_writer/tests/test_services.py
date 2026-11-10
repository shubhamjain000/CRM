"""Service-layer tests for the ai_writer app."""

from __future__ import annotations

from ai_writer.models import AIWriterDraft
from ai_writer.services import (
    generate_email,
    generate_subject_lines,
    generate_summary,
)


pytestmark = pytest.mark.django_db


def test_generate_email_persists_draft(active_tenant, user):  # type: ignore[no-untyped-def]
    draft = generate_email(
        "Cold intro to Acme about our new product.",
        style="professional",
        tone="friendly",
        user=user,
        tenant=active_tenant,
    )
    assert draft.draft_type == "email"
    assert draft.user_id == user.pk
    assert draft.tenant_id == active_tenant.pk
    assert len(draft.generated_content) > 0


def test_generate_summary_and_subjects(active_tenant, user):  # type: ignore[no-untyped-def]
    summary = generate_summary(
        "We discussed pricing, timeline, and integration.",
        user=user,
        tenant=active_tenant,
    )
    assert summary.draft_type == "summary"
    subjects = generate_subject_lines(
        "Hi Jane, following up on our chat.", user=user, tenant=active_tenant,
    )
    assert isinstance(subjects, list)
    assert AIWriterDraft.objects.filter(user=user).count() == 1  # summary only
