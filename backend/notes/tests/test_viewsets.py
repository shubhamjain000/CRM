"""ViewSet / API tests for the notes app."""

from __future__ import annotations

import pytest

from api.factories import UserFactory
from notes.factories import NoteCommentFactory, NoteFactory, NoteShareFactory, NoteVersionFactory
from notes.models import Note, NoteShare


pytestmark = pytest.mark.django_db


def test_list_notes(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    NoteFactory.create_batch(3)
    response = request_factory("GET", "/api/v1/notes/")
    assert response.status_code == 200, response.content
    assert response.json()["count"] == 3


def test_create_note(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    payload = {
        "title": "Kickoff notes",
        "body": "<p>Hello @42 and #phase-6</p>",
        "body_type": "html",
        "tags": ["Phase-6", "phase-6", "  Phase-6  "],
    }
    response = request_factory("POST", "/api/v1/notes/", payload, format="json")
    assert response.status_code == 201, response.content
    body = response.json()
    # Tags are normalized (lowercased + de-duplicated).
    assert body["tags"] == ["phase-6"]
    assert body["author"] == user.pk
    # Signal-populated mentions + hashtags.
    assert 42 in body["mentions"]
    assert "phase-6" in body["hashtags"]


def test_update_note_stamps_last_edited_by(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    note = NoteFactory()
    response = request_factory(
        "PATCH",
        f"/api/v1/notes/{note.pk}/",
        {"title": "Updated title"},
        format="json",
    )
    assert response.status_code == 200, response.content
    note.refresh_from_db()
    assert note.title == "Updated title"
    assert note.last_edited_by_id == user.pk


def test_destroy_note_soft_deletes(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    note = NoteFactory()
    response = request_factory("DELETE", f"/api/v1/notes/{note.pk}/")
    assert response.status_code == 204
    note.refresh_from_db()
    assert note.deleted_at is not None
    assert Note.objects.filter(pk=note.pk).count() == 0


def test_pin_action_toggles_flag(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    note = NoteFactory(is_pinned=False)
    response = request_factory("POST", f"/api/v1/notes/{note.pk}/pin/")
    assert response.status_code == 200, response.content
    note.refresh_from_db()
    assert note.is_pinned is True


def test_share_action_creates_share(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    note = NoteFactory(author=user)
    other = UserFactory()
    response = request_factory(
        "POST",
        f"/api/v1/notes/{note.pk}/share/",
        {"user_id": other.pk, "permission": "edit"},
        format="json",
    )
    assert response.status_code == 201, response.content
    assert NoteShare.objects.filter(note=note, user=other, permission="edit").exists()


def test_share_action_revokes_share(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    note = NoteFactory(author=user)
    share = NoteShareFactory(note=note, permission="read")
    response = request_factory(
        "DELETE",
        f"/api/v1/notes/{note.pk}/share/",
        {"user_id": share.user_id},
        format="json",
    )
    assert response.status_code == 200, response.content
    assert response.json()["deleted"] == 1
    assert not NoteShare.objects.filter(pk=share.pk).exists()


def test_comment_action_creates_comment(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    note = NoteFactory()
    response = request_factory(
        "POST",
        f"/api/v1/notes/{note.pk}/comment/",
        {"body": "Looks good!", "selected_text": "Hello"},
        format="json",
    )
    assert response.status_code == 201, response.content
    assert note.comments.count() == 1


def test_resolve_comment_action_toggles(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    note = NoteFactory()
    comment = NoteCommentFactory(note=note, resolved=False)
    response = request_factory(
        "POST",
        f"/api/v1/notes/{note.pk}/comments/{comment.pk}/resolve/",
        format="json",
    )
    assert response.status_code == 200, response.content
    comment.refresh_from_db()
    assert comment.resolved is True


def test_version_history_action(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    note = NoteFactory()
    NoteVersionFactory(note=note, version_number=1)
    NoteVersionFactory(note=note, version_number=2)
    response = request_factory("GET", f"/api/v1/notes/{note.pk}/version-history/")
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["count"] == 2
    # Newest first.
    assert body["results"][0]["version_number"] == 2


def test_restore_version_action(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    note = NoteFactory(author=user, body="<p>current</p>")
    NoteVersionFactory(note=note, version_number=1, body="<p>v1</p>")
    NoteVersionFactory(note=note, version_number=2, body="<p>v2</p>")
    response = request_factory(
        "POST",
        f"/api/v1/notes/{note.pk}/restore-version/",
        {"version_number": 1},
        format="json",
    )
    assert response.status_code == 200, response.content
    note.refresh_from_db()
    assert note.body == "<p>v1</p>"


def test_save_snapshot_action(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    note = NoteFactory(body="<p>current</p>")
    response = request_factory(
        "POST",
        f"/api/v1/notes/{note.pk}/save-snapshot/",
        {"body": "<p>checkpoint</p>"},
        format="json",
    )
    assert response.status_code == 201, response.content
    assert response.json()["body"] == "<p>checkpoint</p>"


def test_filter_by_pinned(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    NoteFactory.create_batch(2, is_pinned=False)
    NoteFactory(is_pinned=True)
    response = request_factory("GET", "/api/v1/notes/?is_pinned=true")
    assert response.status_code == 200
    assert response.json()["count"] == 1


def test_filter_by_hashtag(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    NoteFactory(hashtags=["phase-6"])
    NoteFactory(hashtags=["other"])
    response = request_factory("GET", "/api/v1/notes/?hashtag=phase-6")
    assert response.status_code == 200
    assert response.json()["count"] == 1


def test_filter_by_tag(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    NoteFactory(tags=["urgent", "phase-6"])
    NoteFactory(tags=["low-priority"])
    response = request_factory("GET", "/api/v1/notes/?tag=phase-6")
    assert response.status_code == 200
    assert response.json()["count"] == 1
