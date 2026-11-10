"""Service-layer tests for the crm_ux app."""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from accounts.factories import AccountFactory
from accounts.models import Account
from api.factories import UserFactory
from contacts.factories import ContactFactory
from contacts.models import Contact
from crm_ux.factories import ActivityFactory, NoteFactory
from crm_ux.models import Activity, Note, RecentlyViewed
from crm_ux.services import (
    get_timeline,
    get_trash_items,
    log_activity,
    parse_mentions_and_hashtags,
    purge_from_trash,
    restore_from_trash,
    track_view,
)

pytestmark = pytest.mark.django_db


# ---------------------------------------------------------------- log_activity


def test_log_activity_creates_row(active_tenant, user):  # type: ignore[no-untyped-def]
    activity = log_activity(
        tenant=active_tenant,
        user=user,
        module="lead",
        record_id="123",
        record_name="Ada Lovelace",
        action="emailed",
        description="Sent outreach email.",
        metadata={"template": "cold-outreach-v1"},
    )
    assert activity.pk is not None
    assert activity.tenant_id == active_tenant.pk
    assert activity.user_id == user.pk
    assert activity.action == "emailed"
    assert activity.metadata == {"template": "cold-outreach-v1"}


def test_log_activity_supports_null_user(active_tenant):  # type: ignore[no-untyped-def]
    activity = log_activity(
        tenant=active_tenant,
        user=None,
        module="lead",
        record_id="1",
        record_name="X",
        action="updated",
    )
    assert activity.user is None


# ---------------------------------------------------------------- track_view


def test_track_view_upserts(active_tenant, user):  # type: ignore[no-untyped-def]
    first = track_view(tenant=active_tenant, user=user, module="lead", record_id="42")
    second = track_view(tenant=active_tenant, user=user, module="lead", record_id="42")
    assert first.pk == second.pk
    assert RecentlyViewed.objects.filter(user=user, module="lead", record_id="42").count() == 1
    assert second.viewed_at >= first.viewed_at


# ---------------------------------------------------------------- timeline


def test_get_timeline_groups_by_bucket(active_tenant, user):  # type: ignore[no-untyped-def]
    now = timezone.now()
    # Today
    ActivityFactory(
        tenant=active_tenant,
        user=user,
        module="lead",
        record_id="1",
        action="created",
        created_at=now,  # auto_now_add normally overrides, so set via refresh
    )
    NoteFactory(
        tenant=active_tenant,
        user=user,
        module="lead",
        record_id="1",
        body="A note",
    )
    buckets = get_timeline(tenant=active_tenant, module="lead", record_id="1")
    assert set(buckets.keys()) == {"Today", "Yesterday", "This Week", "Earlier"}
    # At least the today bucket is non-empty (the note + activity both fall in Today).
    assert len(buckets["Today"]) >= 1


def test_get_timeline_separates_activity_and_note(active_tenant, user):  # type: ignore[no-untyped-def]
    ActivityFactory(
        tenant=active_tenant, user=user, module="lead", record_id="9", action="created"
    )
    NoteFactory(
        tenant=active_tenant, user=user, module="lead", record_id="9", body="hi"
    )
    buckets = get_timeline(tenant=active_tenant, module="lead", record_id="9")
    types_today = {item["type"] for item in buckets["Today"]}
    assert "activity" in types_today
    assert "note" in types_today


# ---------------------------------------------------------------- mention parsing


def test_parse_mentions_and_hashtags_basic():  # type: ignore[no-untyped-def]
    text = "Hello @42 please review #urgent and #blocker"
    result = parse_mentions_and_hashtags(text)
    assert result["mentions"] == [42]
    assert result["hashtags"] == ["blocker", "urgent"]


def test_parse_mentions_resolves_email_to_user_id(active_tenant, user):  # type: ignore[no-untyped-def]
    text = f"Looping in @{user.email} for #review"
    result = parse_mentions_and_hashtags(text, tenant=active_tenant)
    assert result["mentions"] == [user.pk]
    assert result["hashtags"] == ["review"]


def test_parse_mentions_drops_unknown_email(active_tenant):  # type: ignore[no-untyped-def]
    other = UserFactory(email="no-membership@example.com")
    text = f"Ping @{other.email}"
    result = parse_mentions_and_hashtags(text, tenant=active_tenant)
    assert result["mentions"] == []


def test_parse_mentions_deduplicates(active_tenant, user):  # type: ignore[no-untyped-def]
    text = f"@{user.email} @{user.email} #x #x"
    result = parse_mentions_and_hashtags(text, tenant=active_tenant)
    assert result["mentions"] == [user.pk]
    assert result["hashtags"] == ["x"]


def test_parse_mentions_empty():  # type: ignore[no-untyped-def]
    result = parse_mentions_and_hashtags("")
    assert result == {"mentions": [], "hashtags": []}


# ---------------------------------------------------------------- trash


def test_get_trash_items_aggregates_modules(active_tenant, user):  # type: ignore[no-untyped-def]
    account = AccountFactory(tenant=active_tenant, owner=user)
    account.soft_delete()
    contact = ContactFactory(tenant=active_tenant, owner=user)
    contact.soft_delete()
    items = get_trash_items(tenant=active_tenant)
    modules = {item["module"] for item in items}
    assert "account" in modules
    assert "contact" in modules


def test_get_trash_items_filters_by_module(active_tenant, user):  # type: ignore[no-untyped-def]
    account = AccountFactory(tenant=active_tenant, owner=user)
    account.soft_delete()
    contact = ContactFactory(tenant=active_tenant, owner=user)
    contact.soft_delete()
    items = get_trash_items(tenant=active_tenant, module="account")
    assert all(item["module"] == "account" for item in items)
    assert len(items) == 1


def test_restore_from_trash_clears_deleted_at(active_tenant, user):  # type: ignore[no-untyped-def]
    account = AccountFactory(tenant=active_tenant, owner=user)
    account.soft_delete()
    restored = restore_from_trash(
        tenant=active_tenant, module="account", record_id=str(account.pk)
    )
    assert restored.deleted_at is None
    assert Account.objects.filter(pk=account.pk).count() == 1
    # An activity row should have been logged.
    assert Activity.objects.filter(
        module="account", record_id=str(account.pk), action="restored"
    ).exists()


def test_purge_from_trash_permanently_deletes(active_tenant, user):  # type: ignore[no-untyped-def]
    contact = ContactFactory(tenant=active_tenant, owner=user)
    contact.soft_delete()
    pk = contact.pk
    purge_from_trash(tenant=active_tenant, module="contact", record_id=str(pk))
    assert Contact.all_objects.filter(pk=pk).count() == 0
    # An activity row should have been logged.
    assert Activity.objects.filter(
        module="contact", record_id=str(pk), action="deleted"
    ).exists()


def test_purge_skips_non_soft_deleted(active_tenant, user):  # type: ignore[no-untyped-def]
    account = AccountFactory(tenant=active_tenant, owner=user)
    # Not soft-deleted — purge should raise DoesNotExist.
    from django.core.exceptions import ObjectDoesNotExist

    with pytest.raises(ObjectDoesNotExist):
        purge_from_trash(tenant=active_tenant, module="account", record_id=str(account.pk))


# ---------------------------------------------------------------- cleanup_trash task


def test_cleanup_trash_task_purges_old_rows(active_tenant, user):  # type: ignore[no-untyped-def]
    from crm_ux.tasks import cleanup_trash

    old_account = AccountFactory(tenant=active_tenant, owner=user)
    old_account.soft_delete()
    # Backdate the deleted_at timestamp.
    old_account.deleted_at = timezone.now() - timedelta(days=45)
    old_account.save(update_fields=["deleted_at"])

    recent_account = AccountFactory(tenant=active_tenant, owner=user)
    recent_account.soft_delete()  # Just deleted — should be retained.

    summary = cleanup_trash.apply(throw=True).get()  # type: ignore[attr-defined]
    assert summary["purged_per_module"]["account"] == 1
    # Recent account still exists in all_objects.
    assert Account.all_objects.filter(pk=recent_account.pk).exists()
    # Old account is gone.
    assert not Account.all_objects.filter(pk=old_account.pk).exists()
