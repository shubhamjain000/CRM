"""Model-layer tests for the email_integration app."""

from __future__ import annotations

import pytest

from email_integration.factories import (
    EmailAccountFactory,
    EmailFactory,
    EmailSignatureFactory,
    EmailThreadFactory,
    EmailTrackingFactory,
    MailMergeCampaignFactory,
)
from email_integration.models import (
    Email,
    EmailAccount,
    EmailSignature,
    EmailThread,
    EmailTracking,
    MailMergeCampaign,
)


pytestmark = pytest.mark.django_db


def test_email_account_defaults_and_str(active_tenant, user):  # type: ignore[no-untyped-def]
    account = EmailAccountFactory(tenant=active_tenant, user=user, email_address="bob@example.com")
    assert "bob@example.com" in str(account)
    assert account.provider == "imap"
    assert account.sync_enabled is True
    assert account.sync_frequency == 2
    assert account.is_active is True
    assert account.last_synced_at is None


def test_email_factory_creates_inbound_sent_email(active_tenant, user):  # type: ignore[no-untyped-def]
    email = EmailFactory(tenant=active_tenant)
    assert email.direction == "inbound"
    assert email.status == "sent"
    assert email.from_address == "alice@example.com"
    assert "bob@example.com" in email.to_addresses
    assert Email.objects.filter(tenant=active_tenant).count() == 1


def test_email_thread_count_increments(active_tenant, user):  # type: ignore[no-untyped-def]
    thread = EmailThreadFactory(tenant=active_tenant, email_count=0)
    assert "Thread" in str(thread)
    thread.email_count = 3
    thread.save(update_fields=["email_count"])
    assert EmailThread.objects.get(pk=thread.pk).email_count == 3


def test_email_signature_unique_per_user(active_tenant, user):  # type: ignore[no-untyped-def]
    EmailSignatureFactory(tenant=active_tenant, user=user, name="default")
    with pytest.raises(Exception):  # noqa: PT011 — IntegrityError
        EmailSignatureFactory(tenant=active_tenant, user=user, name="default")
    assert EmailSignature.objects.filter(tenant=active_tenant, user=user).count() == 1


def test_email_tracking_and_mail_merge_str(active_tenant, user):  # type: ignore[no-untyped-def]
    email = EmailFactory(tenant=active_tenant)
    event = EmailTrackingFactory(tenant=active_tenant, email=email, event="open")
    assert "open" in str(event).lower()
    campaign = MailMergeCampaignFactory(tenant=active_tenant, created_by=user)
    assert campaign.name in str(campaign)
