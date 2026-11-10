"""Signal-handler tests for the crm_ux app.

Verifies that ``post_save`` on Lead / Contact / Account / Deal auto-logs
the right :class:`crm_ux.models.Activity` row for created / updated /
soft-deleted / restored events.
"""

from __future__ import annotations

import pytest

from accounts.factories import AccountFactory
from contacts.factories import ContactFactory
from crm_ux.models import Activity
from leads.factories import LeadFactory
from leads.models import Lead

pytestmark = pytest.mark.django_db


def test_lead_create_logs_created_activity(active_tenant, user):  # type: ignore[no-untyped-def]
    lead = LeadFactory()
    activity = Activity.objects.filter(
        tenant=active_tenant,
        module="lead",
        record_id=str(lead.pk),
        action="created",
    ).first()
    assert activity is not None
    assert activity.user_id == lead.owner_id
    assert "Created lead" in activity.description


def test_lead_update_logs_updated_activity(active_tenant):  # type: ignore[no-untyped-def]
    lead = LeadFactory()
    # Clear the 'created' activity so we can assert 'updated' is the latest.
    Activity.objects.filter(module="lead", record_id=str(lead.pk)).delete()
    lead.lead_status = "contacted"
    lead.save(update_fields=["lead_status", "updated_at"])
    activity = Activity.objects.filter(
        module="lead",
        record_id=str(lead.pk),
        action="updated",
    ).first()
    assert activity is not None
    assert "Updated lead" in activity.description


def test_lead_soft_delete_logs_deleted_activity(active_tenant):  # type: ignore[no-untyped-def]
    lead = LeadFactory()
    Activity.objects.filter(module="lead", record_id=str(lead.pk)).delete()
    lead.soft_delete()
    activity = Activity.objects.filter(
        module="lead",
        record_id=str(lead.pk),
        action="deleted",
    ).first()
    assert activity is not None
    assert "Soft-deleted lead" in activity.description


def test_lead_restore_logs_restored_activity(active_tenant):  # type: ignore[no-untyped-def]
    lead = LeadFactory()
    lead.soft_delete()
    Activity.objects.filter(module="lead", record_id=str(lead.pk)).delete()
    lead.restore()
    activity = Activity.objects.filter(
        module="lead",
        record_id=str(lead.pk),
        action="restored",
    ).first()
    assert activity is not None
    assert "Restored lead" in activity.description


def test_account_create_logs_created_activity(active_tenant):  # type: ignore[no-untyped-def]
    account = AccountFactory()
    activity = Activity.objects.filter(
        module="account",
        record_id=str(account.pk),
        action="created",
    ).first()
    assert activity is not None


def test_contact_create_logs_created_activity(active_tenant):  # type: ignore[no-untyped-def]
    contact = ContactFactory()
    activity = Activity.objects.filter(
        module="contact",
        record_id=str(contact.pk),
        action="created",
    ).first()
    assert activity is not None


def test_signal_skips_raw_loads(active_tenant, user):  # type: ignore[no-untyped-def]
    """When ``raw=True`` (fixture loads), no activity should be written."""
    from django.db.models.signals import post_save

    lead = LeadFactory.build(first_name="Raw")
    lead.tenant = active_tenant
    lead.owner = user
    # Send the signal with raw=True — the handler should no-op.
    post_save.send(sender=Lead, instance=lead, created=True, raw=True, update_fields=None)
    assert not Activity.objects.filter(
        module="lead", record_id=str(lead.pk)
    ).exists()


def test_signal_skips_instances_without_tenant(active_tenant):  # type: ignore[no-untyped-def]
    """A Lead without a tenant_id should not trigger an activity write."""
    from django.db.models.signals import post_save

    lead = LeadFactory.build(first_name="NoTenant")
    lead.tenant = None
    lead.owner = None  # owner is required, but we'll skip save() entirely
    post_save.send(sender=Lead, instance=lead, created=True, raw=False, update_fields=None)
    assert not Activity.objects.filter(
        module="lead", record_id=str(lead.pk)
    ).exists()
