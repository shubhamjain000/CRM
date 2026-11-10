"""Celery tasks for the email_integration app.

* :func:`sync_all_accounts` — beat every 2 min, sweeps every active
  ``EmailAccount`` with ``sync_enabled=True`` and calls
  :func:`email_integration.services.sync_imap`.
* :func:`send_scheduled_emails` — beat every 1 min, dispatches every
  queued email whose ``scheduled_at`` has elapsed via SMTP.
* :func:`send_mail_merge_campaign` — bulk-send a campaign (called
  async by the ``start`` viewset action).
* :func:`check_follow_up_reminders` — beat daily, surfaces emails
  flagged for follow-up to their owners.
"""

from __future__ import annotations

import logging
from typing import Any

from celery import shared_task
from django.utils import timezone

from .models import (
    CAMPAIGN_COMPLETED,
    CAMPAIGN_FAILED,
    CAMPAIGN_RUNNING,
    Email,
    EmailAccount,
    MailMergeCampaign,
    STATUS_QUEUED,
    STATUS_SENT,
)
from .services import (
    render_template,
    send_email,
    sync_imap,
)

log = logging.getLogger(__name__)


@shared_task(name="email_integration.sync_all_accounts")
def sync_all_accounts() -> dict[str, Any]:
    """Sweep every active ``EmailAccount`` and pull new mail."""
    accounts = EmailAccount.objects.filter(is_active=True, sync_enabled=True)
    total_new = 0
    synced = 0
    failed = 0
    for account in accounts:
        try:
            created = sync_imap(account)
            total_new += len(created)
            synced += 1
        except Exception:  # pragma: no cover — defensive
            log.exception("email_integration.sync_all_accounts: account %s failed", account.pk)
            failed += 1
    return {"accounts_synced": synced, "new_messages": total_new, "failed": failed}


@shared_task(name="email_integration.send_scheduled_emails")
def send_scheduled_emails() -> dict[str, Any]:
    """Dispatch every queued email whose ``scheduled_at`` has elapsed."""
    now = timezone.now()
    pending = Email.objects.filter(status=STATUS_QUEUED, scheduled_at__lte=now).select_related(
        "account", "tenant"
    )
    sent = 0
    failed = 0
    for email in pending:
        if email.account is None:
            continue
        try:
            # Re-use the immediate-send path by clearing scheduled_at.
            # The service records a fresh row; we update this one in-place.
            from .services import _smtp_send  # noqa: PLC0415 — lazy import to avoid cycle

            message_id = _smtp_send(
                email.account,
                {
                    "to": email.to_addresses,
                    "cc": email.cc,
                    "bcc": email.bcc,
                    "subject": email.subject,
                    "body_html": email.body_html,
                    "attachments": email.attachments,
                },
            )
            email.message_id = message_id or ""
            email.status = STATUS_SENT
            email.sent_at = timezone.now()
            email.scheduled_at = None
            email.save(
                update_fields=[
                    "message_id",
                    "status",
                    "sent_at",
                    "scheduled_at",
                    "updated_at",
                ]
            )
            sent += 1
        except Exception:  # pragma: no cover — defensive
            log.exception("email_integration.send_scheduled_emails: email %s failed", email.pk)
            failed += 1
    return {"sent": sent, "failed": failed}


@shared_task(name="email_integration.send_mail_merge_campaign")
def send_mail_merge_campaign(campaign_id: int) -> dict[str, Any]:
    """Send every recipient in ``campaign_id`` with variable substitution."""
    campaign = MailMergeCampaign.objects.select_related("account", "tenant").get(  # type: ignore[attr-defined]
        pk=campaign_id
    )
    # ``MailMergeCampaign`` does not own an EmailAccount FK — we resolve the
    # tenant's first active account at runtime. (See model docstring.)
    account = EmailAccount.objects.filter(tenant=campaign.tenant, is_active=True).first()
    if account is None:
        campaign.status = CAMPAIGN_FAILED
        campaign.save(update_fields=["status", "updated_at"])
        return {"error": "no active email account for tenant"}

    campaign.status = CAMPAIGN_RUNNING
    campaign.save(update_fields=["status", "updated_at"])
    sent = 0
    failed = 0
    for recipient in campaign.recipients or []:
        email = recipient.get("email") if isinstance(recipient, dict) else None
        if not email:
            failed += 1
            continue
        variables = recipient.get("variables", {}) if isinstance(recipient, dict) else {}
        try:
            send_email(
                account=account,
                to=[email],
                subject=render_template(campaign.template_subject, variables),
                body_html=render_template(campaign.template_body_html, variables),
            )
            sent += 1
        except Exception:  # pragma: no cover — defensive
            log.exception("mail merge campaign %s: recipient %s failed", campaign.pk, email)
            failed += 1
    campaign.sent_count = sent
    campaign.failed_count = failed
    campaign.status = CAMPAIGN_COMPLETED if failed == 0 else CAMPAIGN_FAILED
    campaign.save(
        update_fields=["sent_count", "failed_count", "status", "updated_at"]
    )
    return {"sent": sent, "failed": failed}


@shared_task(name="email_integration.check_follow_up_reminders")
def check_follow_up_reminders() -> dict[str, Any]:
    """Daily sweep — surface emails flagged ``needs_follow_up`` to owners.

    This is a thin stub that returns the count of follow-up-flagged emails
    per tenant. The notifications app dispatches the actual reminders.
    """
    flagged = Email.objects.filter(labels__contains=["needs_follow_up"])
    return {"flagged_count": flagged.count()}
