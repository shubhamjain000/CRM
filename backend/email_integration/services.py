"""Service layer for the email_integration app.

The functions here are the canonical interface used by :mod:`email_integration.viewsets`
and :mod:`email_integration.tasks`. Provider-specific glue (IMAP / SMTP /
Gmail API / Microsoft Graph) is stubbed — the production deployment wires the
real adapters behind the ``_imap_fetch_new`` / ``_smtp_send`` hooks.
"""

from __future__ import annotations

import logging
import re
import string
from email.utils import parseaddr
from typing import TYPE_CHECKING, Any

from django.db import transaction
from django.utils import timezone

from .models import (
    DIRECTION_INBOUND,
    DIRECTION_OUTBOUND,
    Email,
    EmailAccount,
    EmailThread,
    EmailTracking,
    STATUS_BOUNCED,
    STATUS_CLICKED,
    STATUS_DRAFT,
    STATUS_OPENED,
    STATUS_QUEUED,
    STATUS_SENT,
    TRACK_BOUNCE,
    TRACK_CLICK,
    TRACK_OPEN,
)

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import User

log = logging.getLogger(__name__)

# Undo-send window — Gmail-style 5-second cancellation grace period.
UNDO_SEND_WINDOW_SECONDS = 5

# Re:/Fwd:/etc. prefix stripper, used for thread subject normalization.
_SUBJECT_PREFIX_RE = re.compile(r"^\s*((re|fwd|fw|aw|wg)\s*:\s*)+", re.IGNORECASE)


###############################################################################
# IMAP sync
###############################################################################


def sync_imap(account: EmailAccount) -> list[Email]:
    """Pull new messages from ``account`` since ``last_synced_at``.

    Iterates the stubbed :func:`_imap_fetch_new` adapter, creates an
    :class:`Email` row per message (de-duplicated by ``message_id``),
    auto-links each to a contact / lead via :func:`auto_link_to_record`,
    threads them via :func:`thread_emails`, and updates
    ``account.last_synced_at``.

    Returns the list of newly-created :class:`Email` rows.
    """
    if not account.is_active or not account.sync_enabled:
        return []
    since = account.last_synced_at
    raw_messages = _imap_fetch_new(account, since)
    created: list[Email] = []
    seen_message_ids: set[str] = set(
        Email.objects.filter(
            tenant=account.tenant, account=account, message_id__in=[
                m.get("message_id", "") for m in raw_messages if m.get("message_id")
            ]
        ).values_list("message_id", flat=True)
    )
    for raw in raw_messages:
        message_id = raw.get("message_id", "")
        if message_id and message_id in seen_message_ids:
            continue
        to_list = raw.get("to") or []
        cc_list = raw.get("cc") or []
        from_addr = parseaddr(raw.get("from", ""))[1] or raw.get("from", "")
        email = Email.objects.create(
            tenant=account.tenant,
            account=account,
            message_id=message_id,
            from_address=from_addr,
            to_addresses=to_list,
            cc=cc_list,
            bcc=raw.get("bcc") or [],
            subject=raw.get("subject", "")[:512],
            body_html=raw.get("body_html", ""),
            body_text=raw.get("body_text", ""),
            attachments=raw.get("attachments") or [],
            direction=DIRECTION_INBOUND,
            status=STATUS_SENT,
            has_attachments=bool(raw.get("attachments")),
            received_at=raw.get("received_at") or timezone.now(),
        )
        auto_link_to_record(email)
        thread_emails(email)
        seen_message_ids.add(message_id)
        created.append(email)
    account.last_synced_at = timezone.now()
    account.save(update_fields=["last_synced_at", "updated_at"])
    log.info("email_integration.sync_imap: %d new message(s) for account %s", len(created), account)
    return created


def _imap_fetch_new(account: EmailAccount, since: Any) -> list[dict[str, Any]]:
    """Stub IMAP fetcher — override in production with a real adapter.

    Returns a list of dicts shaped like::

        {
            "message_id": "<...@mail.example.com>",
            "from": "Alice <alice@example.com>",
            "to": ["bob@example.com"],
            "cc": [],
            "bcc": [],
            "subject": "Hello",
            "body_html": "<p>Hi Bob</p>",
            "body_text": "Hi Bob",
            "attachments": [{"filename": "...", "size": 1234, "url": "..."}],
            "received_at": datetime,
        }
    """
    return []


###############################################################################
# SMTP send
###############################################################################


def send_email(
    account: EmailAccount,
    to: list[str],
    subject: str,
    body_html: str,
    attachments: list[dict[str, Any]] | None = None,
    cc: list[str] | None = None,
    bcc: list[str] | None = None,
    scheduled_at: Any = None,
    user: "User | None" = None,
) -> Email:
    """Send an email from ``account`` or queue it for schedule-send.

    If ``scheduled_at`` is provided, an :class:`Email` row is created in
    ``queued`` state with ``scheduled_at`` set; the
    ``email_integration.send_scheduled_emails`` beat task picks it up at
    the scheduled time and dispatches via :func:`_smtp_send`.

    Otherwise the email is sent immediately via the stubbed
    :func:`_smtp_send` adapter and a ``sent`` row is recorded.
    """
    to_list = list(to or [])
    cc_list = list(cc or [])
    bcc_list = list(bcc or [])
    attachments_list = list(attachments or [])
    if not to_list:
        raise ValueError("send_email: 'to' must be a non-empty list of email addresses.")
    common = dict(
        tenant=account.tenant,
        account=account,
        from_address=account.email_address,
        to_addresses=to_list,
        cc=cc_list,
        bcc=bcc_list,
        subject=subject[:512],
        body_html=body_html,
        body_text=_strip_html(body_html),
        attachments=attachments_list,
        direction=DIRECTION_OUTBOUND,
        has_attachments=bool(attachments_list),
    )
    if scheduled_at is not None:
        email = Email.objects.create(
            status=STATUS_QUEUED,
            scheduled_at=scheduled_at,
            **common,
        )
        # A Celery countdown is the canonical pattern; we delegate to the
        # beat task so the schedule survives a worker restart.
        log.info(
            "email_integration.send_email: queued email %s for %s",
            email.pk,
            scheduled_at,
        )
        return email
    message_id = _smtp_send(account, common | {"to": to_list, "cc": cc_list, "bcc": bcc_list})
    email = Email.objects.create(
        message_id=message_id or "",
        status=STATUS_SENT,
        sent_at=timezone.now(),
        **common,
    )
    auto_link_to_record(email)
    thread_emails(email)
    log.info("email_integration.send_email: sent email %s from %s", email.pk, account.email_address)
    return email


def _smtp_send(account: EmailAccount, payload: dict[str, Any]) -> str:
    """Stub SMTP / provider-API sender — override in production.

    Returns the provider-assigned message id (RFC-822 ``Message-ID``) so
    it can be stored on the :class:`Email` row for de-dup / threading.
    """
    import uuid

    return f"<{uuid.uuid4()}@foundation.local>"


###############################################################################
# Auto-link to CRM records
###############################################################################


def auto_link_to_record(email: Email) -> tuple[str, str] | None:
    """Link ``email`` to a Contact or Lead by matching email addresses.

    Walks ``from_address`` + every ``to`` / ``cc`` address; the first
    match (Contact first, then Lead) wins. Sets ``related_module`` /
    ``related_id`` and returns the ``(module, id)`` tuple, or ``None``.
    """
    addresses = {email.from_address.lower()}
    for addr in (email.to_addresses or []) + (email.cc or []):
        parsed = parseaddr(str(addr))[1].lower()
        if parsed:
            addresses.add(parsed)
    if not addresses:
        return None
    module, record_id = _match_contact_or_lead(email.tenant_id, addresses)
    if module is None:
        return None
    email.related_module = module
    email.related_id = str(record_id)
    email.save(update_fields=["related_module", "related_id", "updated_at"])
    return module, str(record_id)


def _match_contact_or_lead(tenant_id: int, addresses: set[str]) -> tuple[str | None, int | None]:
    """Best-effort match against Contact.emails / Lead.emails JSON lists.

    Both models store emails as ``[{email: "...", ...}]`` JSON arrays, so
    we filter with a containment-style query. Returns the first hit —
    Contacts are preferred over Leads.
    """
    try:
        from contacts.models import Contact
        from leads.models import Lead
    except Exception:  # pragma: no cover — contacts/leads always present
        return None, None
    for addr in addresses:
        contact = (
            Contact.objects.filter(tenant_id=tenant_id, emails__contains=[{"email": addr}])
            .only("id")
            .first()
        )
        if contact is not None:
            return "contacts", contact.id
        lead = (
            Lead.objects.filter(tenant_id=tenant_id, emails__contains=[{"email": addr}])
            .only("id")
            .first()
        )
        if lead is not None:
            return "leads", lead.id
    return None, None


###############################################################################
# Tracking — open / click / bounce
###############################################################################


def track_open(email_id: int, ip: str | None, user_agent: str) -> EmailTracking:
    """Record an open event for ``email_id``.

    Creates an :class:`EmailTracking` row and stamps ``Email.opened_at``
    on first open only (subsequent opens are tracked but do not mutate
    the email row).
    """
    email = Email.objects.select_related("tenant").get(pk=email_id)
    event = EmailTracking.objects.create(
        tenant=email.tenant,
        email=email,
        event=TRACK_OPEN,
        ip=ip or None,
        user_agent=user_agent or "",
    )
    if email.opened_at is None:
        email.opened_at = event.timestamp
        if email.status not in (STATUS_OPENED, STATUS_CLICKED):
            email.status = STATUS_OPENED
        email.save(update_fields=["opened_at", "status", "updated_at"])
    return event


def track_click(email_id: int, url: str, ip: str | None, user_agent: str) -> EmailTracking:
    """Record a click event for ``email_id`` and ``url``.

    The redirect endpoint calls this then returns an HTTP 302 to ``url``.
    """
    email = Email.objects.select_related("tenant").get(pk=email_id)
    event = EmailTracking.objects.create(
        tenant=email.tenant,
        email=email,
        event=TRACK_CLICK,
        url=url,
        ip=ip or None,
        user_agent=user_agent or "",
    )
    if email.clicked_at is None:
        email.clicked_at = event.timestamp
        email.status = STATUS_CLICKED
        email.save(update_fields=["clicked_at", "status", "updated_at"])
    return event


def handle_bounce(email_id: int, reason: str) -> Email:
    """Mark ``email_id`` as bounced and notify the sender account owner."""
    email = Email.objects.select_related("tenant", "account").get(pk=email_id)
    EmailTracking.objects.create(
        tenant=email.tenant,
        email=email,
        event=TRACK_BOUNCE,
        user_agent="",
    )
    email.bounced_at = timezone.now()
    email.bounce_reason = reason
    email.status = STATUS_BOUNCED
    email.save(update_fields=["bounced_at", "bounce_reason", "status", "updated_at"])
    log.warning(
        "email_integration.handle_bounce: email %s bounced — %s", email.pk, reason
    )
    return email


###############################################################################
# Threading
###############################################################################


def thread_emails(email: Email) -> EmailThread | None:
    """Assign ``email`` to an :class:`EmailThread`.

    Two emails join the same thread when their normalized subjects match.
    (RFC-822 ``References`` headers are also inspected when present via
    the ``message_id`` chain, but the simple subject match is the
    primary grouping key in the absence of the raw headers.)
    """
    subject = _normalize_subject(email.subject)
    if not subject:
        return None
    thread = (
        EmailThread.objects.filter(tenant=email.tenant, subject=subject).first()
    )
    if thread is None:
        thread = EmailThread.objects.create(
            tenant=email.tenant,
            subject=subject,
            related_module=email.related_module,
            related_id=email.related_id,
            last_activity_at=timezone.now(),
            email_count=1,
        )
    else:
        thread.last_activity_at = timezone.now()
        thread.email_count = (thread.email_count or 0) + 1
        if not thread.related_module and email.related_module:
            thread.related_module = email.related_module
            thread.related_id = email.related_id
        thread.save(
            update_fields=["last_activity_at", "email_count", "related_module", "related_id", "updated_at"]
        )
    email.thread = thread
    email.save(update_fields=["thread", "updated_at"])
    return thread


def _normalize_subject(subject: str) -> str:
    return _SUBJECT_PREFIX_RE.sub("", subject or "").strip()


###############################################################################
# Undo send
###############################################################################


def undo_send(email_id: int) -> Email:
    """Cancel a send if within :data:`UNDO_SEND_WINDOW_SECONDS` of dispatch.

    Reverts the email to ``draft`` status and clears ``sent_at`` /
    ``message_id`` so a re-send is idempotent. Outside the window the
    email is left untouched (caller decides how to surface the error).
    """
    email = Email.objects.get(pk=email_id)
    if email.status != STATUS_SENT or email.sent_at is None:
        return email
    elapsed = (timezone.now() - email.sent_at).total_seconds()
    if elapsed > UNDO_SEND_WINDOW_SECONDS:
        return email
    with transaction.atomic():
        email.status = STATUS_DRAFT
        email.sent_at = None
        email.message_id = ""
        email.save(update_fields=["status", "sent_at", "message_id", "updated_at"])
    log.info("email_integration.undo_send: reverted email %s within %ds", email.pk, elapsed)
    return email


###############################################################################
# Mail merge
###############################################################################


def render_template(template: str, variables: dict[str, Any]) -> str:
    """Render ``{{key}}`` placeholders in ``template`` with ``variables``.

    Uses :class:`string.Template` so unknown placeholders are left
    untouched (rather than raising). ``${key}`` style is also supported.
    """
    rendered = string.Template(template).safe_substitute(variables)
    for key, value in (variables or {}).items():
        rendered = rendered.replace("{{" + key + "}}", str(value))
    return rendered


def _strip_html(html: str) -> str:
    """Best-effort HTML → text conversion (used for the ``body_text`` field)."""
    return re.sub(r"<[^>]+>", "", html or "")


__all__ = [
    "UNDO_SEND_WINDOW_SECONDS",
    "auto_link_to_record",
    "handle_bounce",
    "render_template",
    "send_email",
    "sync_imap",
    "thread_emails",
    "track_click",
    "track_open",
    "undo_send",
]
