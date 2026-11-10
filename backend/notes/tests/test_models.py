"""Model-level tests for the notes app."""

from __future__ import annotations

import pytest
from django.db import IntegrityError

from api.factories import OrganizationFactory, UserFactory
from api.managers import set_current_tenant, tenant_context
from notes.factories import (
    NoteCommentFactory,
    NoteFactory,
    NoteShareFactory,
    NoteVersionFactory,
)
from notes.models import Note, NoteComment, NoteShare, NoteVersion


pytestmark = pytest.mark.django_db


def test_note_factory_creates_row(active_tenant):  # type: ignore[no-untyped-def]
    note = NoteFactory()
    assert note.pk is not None
    assert note.tenant_id == active_tenant.pk
    assert note.body_type == "html"


def test_note_str(active_tenant):  # type: ignore[no-untyped-def]
    note = NoteFactory(title="Kickoff notes")
    assert str(note) == "Kickoff notes"


def test_soft_delete(active_tenant):  # type: ignore[no-untyped-def]
    note = NoteFactory()
    note.soft_delete()
    assert Note.objects.filter(pk=note.pk).count() == 0
    assert Note.all_objects.filter(pk=note.pk).count() == 1


def test_tenant_scoping_filters_other_tenants(active_tenant):  # type: ignore[no-untyped-def]
    other = OrganizationFactory(subdomain="otherorg", slug="otherorg")
    with tenant_context(other):
        NoteFactory(title="Other")
    set_current_tenant(active_tenant)
    NoteFactory(title="Mine")
    titles = [n.title for n in Note.objects.all()]
    assert titles == ["Mine"]


def test_next_version_number_increments(active_tenant):  # type: ignore[no-untyped-def]
    note = NoteFactory()
    assert note.next_version_number() == 1
    NoteVersionFactory(note=note, version_number=1)
    assert note.next_version_number() == 2
    NoteVersionFactory(note=note, version_number=2)
    assert note.next_version_number() == 3


def test_note_share_unique_per_note_user(active_tenant):  # type: ignore[no-untyped-def]
    note = NoteFactory()
    share = NoteShareFactory(note=note)
    with pytest.raises(IntegrityError):
        NoteShare.objects.create(note=note, user=share.user, permission="edit")


def test_note_share_permission_check_constraint(active_tenant):  # type: ignore[no-untyped-def]
    note = NoteFactory()
    user = UserFactory()
    share = NoteShare(note=note, user=user, permission="bogus")
    with pytest.raises(IntegrityError):
        share.save()


def test_note_version_unique_per_note_number(active_tenant):  # type: ignore[no-untyped-def]
    note = NoteFactory()
    NoteVersionFactory(note=note, version_number=1)
    with pytest.raises(IntegrityError):
        NoteVersionFactory(note=note, version_number=1)


def test_comment_relationship(active_tenant):  # type: ignore[no-untyped-def]
    note = NoteFactory()
    comment = NoteCommentFactory(note=note, body="First!")
    assert comment.note_id == note.pk
    assert list(note.comments.all()) == [comment]


def test_resolve_toggle_via_save(active_tenant):  # type: ignore[no-untyped-def]
    comment = NoteCommentFactory(resolved=False)
    comment.resolved = True
    comment.save(update_fields=["resolved", "updated_at"])
    comment.refresh_from_db()
    assert comment.resolved is True


def test_check_constraint_rejects_invalid_body_type(active_tenant):  # type: ignore[no-untyped-def]
    note = NoteFactory.build(body_type="bogus")
    note.tenant = active_tenant
    with pytest.raises(IntegrityError):
        note.save()
