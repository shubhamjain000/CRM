"""Service-layer tests for the email_integration app."""

from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

from email_integration.factories import (
    EmailAccountFactory,
    EmailFactory,
)
from email_integration.models import Email, EmailTracking
from email_integration.services import (
    auto_link_to_record,
    handle_bounce,
    render_template,
    send_email,
    thread_emails,
    track_click,
    track_open,
    undo_send,
)


pytestmark = pytest.mark.django_db


def test_send_email_immediate_creates_sent_row(active_tenant, user):  # type: ignore[no-untyped-def]
    account = EmailAccountFactory(tenant=active_tenant, user=user)
    email = send_email(
        account=account,
        to=["alice@example.com"],
        subject="Hello",
        body_html="<p>Hi</p>",
    )
    assert email.direction == "outbound"
    assert email.status == "sent"
    assert email.sent_at is not None
    assert email.scheduled_at is None
    assert email.from_address == account.email_address


def test_send_email_scheduled_creates_queued_row(active_tenant, user):  # type: ignore[no-untyped-def]
    account = EmailAccountFactory(tenant=active_tenant, user=user)
    future = timezone.now() + timedelta(minutes=10)
    email = send_email(
        account=account,
        to=["alice@example.com"],
        subject="Later",
        body_html="<p>…</p>",
        scheduled_at=future,
    )
    assert email.status == "queued"
    assert email.scheduled_at == future
    assert email.sent_at is None


def test_track_open_stamps_opened_at_only_once(active_tenant, user):  # type: ignore[no-untyped-def]
    email = EmailFactory(tenant=active_tenant)
    track_open(email.pk, "127.0.0.1", "Mozilla/5.0")
    email.refresh_from_db()
    first_opened = email.opened_at
    assert first_opened is not None
    assert email.status == "opened"
    track_open(email.pk, "127.0.0.1", "Mozilla/5.0")
    email.refresh_from_db()
    # Subsequent opens don't overwrite the first-opened timestamp.
    assert email.opened_at == first_opened
    assert EmailTracking.objects.filter(email=email, event="open").count() == 2


def test_track_click_updates_clicked_at_and_status(active_tenant, user):  # type: ignore[no-untyped-def]
    email = EmailFactory(tenant=active_tenant)
    track_click(email.pk, "https://example.com/offer", "10.0.0.1", "curl/8")
    email.refresh_from_db()
    assert email.clicked_at is not None
    assert email.status == "clicked"


def test_handle_bounce_marks_email_bounced(active_tenant, user):  # type: ignore[no-untyped-def]
    email = EmailFactory(tenant=active_tenant)
    handle_bounce(email.pk, "550 mailbox unavailable")
    email.refresh_from_db()
    assert email.status == "bounced"
    assert "550" in email.bounce_reason
    assert email.bounced_at is not None


def test_undo_send_reverts_within_window(active_tenant, user):  # type: ignore[no-untyped-def]
    email = send_email(
        account=EmailAccountFactory(tenant=active_tenant, user=user),
        to=["x@example.com"],
        subject="Oops",
        body_html="<p>…</p>",
    )
    reverted = undo_send(email.pk)
    assert reverted.status == "draft"
    assert reverted.sent_at is None


def test_thread_emails_groups_by_normalized_subject(active_tenant, user):  # type: ignore[no-untyped-def]
    email1 = EmailFactory(tenant=active_tenant, subject="Re: Project Phoenix")
    email2 = EmailFactory(tenant=active_tenant, subject="Fwd: Project Phoenix")
    thread1 = thread_emails(email1)
    thread2 = thread_emails(email2)
    assert thread1.pk == thread2.pk
    thread1.refresh_from_db()
    assert thread1.email_count == 2


def test_render_template_substitutes_placeholders(active_tenant, user):  # type: ignore[no-untyped-def]
    out = render_template("Hello {{name}} from ${company}", {"name": "Alice", "company": "Acme"})
    assert "Hello Alice from Acme" == out


def test_auto_link_to_record_returns_none_without_match(active_tenant, user):  # type: ignore[no-untyped-def]
    email = EmailFactory(tenant=active_tenant)
    assert auto_link_to_record(email) is None
