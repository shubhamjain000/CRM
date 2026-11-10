"""Model-level tests for the crm_ux app."""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.db import IntegrityError
from django.utils import timezone

from crm_ux.factories import (
    ActivityFactory,
    FileAttachmentFactory,
    NoteFactory,
    RecordLockFactory,
    RecentlyViewedFactory,
    SavedViewFactory,
)
from crm_ux.models import (
    Activity,
    FileAttachment,
    Note,
    RecordLock,
    RecentlyViewed,
    SavedView,
)

pytestmark = pytest.mark.django_db


# ---------------------------------------------------------------- SavedView


def test_saved_view_factory_creates_row(active_tenant, user):  # type: ignore[no-untyped-def]
    view = SavedViewFactory()
    assert view.pk is not None
    assert view.tenant_id == active_tenant.pk
    assert view.user_id == user.pk
    assert view.is_default is False
    assert "filters" in view.config


def test_saved_view_unique_name_per_user(active_tenant, user):  # type: ignore[no-untyped-def]
    SavedViewFactory(user=user, tenant=active_tenant, name="My View")
    with pytest.raises(IntegrityError):
        SavedViewFactory(user=user, tenant=active_tenant, name="My View")


# ---------------------------------------------------------------- RecentlyViewed


def test_recently_viewed_factory_creates_row(active_tenant):  # type: ignore[no-untyped-def]
    rv = RecentlyViewedFactory()
    assert rv.pk is not None
    assert rv.tenant_id == active_tenant.pk
    assert rv.viewed_at is not None


# ---------------------------------------------------------------- Activity


def test_activity_factory_creates_row(active_tenant):  # type: ignore[no-untyped-def]
    activity = ActivityFactory()
    assert activity.pk is not None
    assert activity.tenant_id == active_tenant.pk
    assert activity.action == "created"


def test_activity_user_nullable(active_tenant):  # type: ignore[no-untyped-def]
    activity = ActivityFactory(user=None)
    assert activity.user is None


# ---------------------------------------------------------------- Note


def test_note_factory_creates_row(active_tenant):  # type: ignore[no-untyped-def]
    note = NoteFactory(body="Hello world")
    assert note.pk is not None
    assert note.tenant_id == active_tenant.pk
    assert note.body == "Hello world"
    assert note.mentions == []
    assert note.hashtags == []


# ---------------------------------------------------------------- FileAttachment


def test_file_attachment_factory_creates_row(active_tenant):  # type: ignore[no-untyped-def]
    attachment = FileAttachmentFactory()
    assert attachment.pk is not None
    assert attachment.tenant_id == active_tenant.pk
    assert attachment.filename == "test.txt"
    assert attachment.file_size == 1024


# ---------------------------------------------------------------- RecordLock


def test_record_lock_factory_auto_sets_expires_at(active_tenant):  # type: ignore[no-untyped-def]
    lock = RecordLockFactory()
    assert lock.pk is not None
    assert lock.expires_at is not None
    # TTL is 4 hours per RECORD_LOCK_TTL.
    assert lock.expires_at > lock.locked_at
    delta = lock.expires_at - lock.locked_at
    assert timedelta(hours=3, minutes=59) < delta < timedelta(hours=4, minutes=1)


def test_record_lock_unique_per_record(active_tenant, user):  # type: ignore[no-untyped-def]
    RecordLockFactory(user=user, tenant=active_tenant, module="lead", record_id="42")
    with pytest.raises(IntegrityError):
        RecordLockFactory(user=user, tenant=active_tenant, module="lead", record_id="42")


def test_record_lock_is_expired_property(active_tenant):  # type: ignore[no-untyped-def]
    lock = RecordLockFactory()
    assert lock.is_expired is False
    lock.expires_at = timezone.now() - timedelta(minutes=1)
    lock.save(update_fields=["expires_at"])
    assert lock.is_expired is True
