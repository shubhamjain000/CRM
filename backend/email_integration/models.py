"""Database models for the email_integration app.

All six models are tenant-scoped (inherit :class:`api.models.TenantModel`)
and follow the established pattern (TenantManager + TimestampedModel):

* :class:`EmailAccount` — a connected mailbox (IMAP/OAuth/Exchange) that
  the sync engine pulls inbound mail from and the SMTP sender sends
  outbound mail through.
* :class:`EmailThread` — a grouped conversation. Two emails belong to the
  same thread when their RFC-822 ``References`` chain overlaps or their
  normalized subject matches (see :func:`email_integration.services.thread_emails`).
* :class:`Email` — a single RFC-822 message (inbound or outbound) with
  delivery / open / click / bounce lifecycle timestamps.
* :class:`EmailSignature` — per-user HTML signature, one default per user.
* :class:`EmailTracking` — append-only open / click / bounce / spam event
  log written by the tracking pixel + redirect endpoint.
* :class:`MailMergeCampaign` — bulk send of a templated email to a list
  of recipients with per-recipient variable substitution.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import TenantModel, User

###############################################################################
# Constants — providers
###############################################################################

PROVIDER_GMAIL = "gmail"
PROVIDER_OUTLOOK = "outlook"
PROVIDER_IMAP = "imap"
PROVIDER_EXCHANGE = "exchange"
PROVIDER_YAHOO = "yahoo"
PROVIDER_CUSTOM = "custom"
PROVIDER_CHOICES = [
    (PROVIDER_GMAIL, "Gmail"),
    (PROVIDER_OUTLOOK, "Outlook"),
    (PROVIDER_IMAP, "IMAP"),
    (PROVIDER_EXCHANGE, "Exchange"),
    (PROVIDER_YAHOO, "Yahoo"),
    (PROVIDER_CUSTOM, "Custom"),
]

###############################################################################
# Constants — email direction + status
###############################################################################

DIRECTION_INBOUND = "inbound"
DIRECTION_OUTBOUND = "outbound"
DIRECTION_CHOICES = [
    (DIRECTION_INBOUND, "Inbound"),
    (DIRECTION_OUTBOUND, "Outbound"),
]

STATUS_DRAFT = "draft"
STATUS_QUEUED = "queued"
STATUS_SENT = "sent"
STATUS_DELIVERED = "delivered"
STATUS_BOUNCED = "bounced"
STATUS_OPENED = "opened"
STATUS_CLICKED = "clicked"
STATUS_SPAM = "spam"
STATUS_CHOICES = [
    (STATUS_DRAFT, "Draft"),
    (STATUS_QUEUED, "Queued"),
    (STATUS_SENT, "Sent"),
    (STATUS_DELIVERED, "Delivered"),
    (STATUS_BOUNCED, "Bounced"),
    (STATUS_OPENED, "Opened"),
    (STATUS_CLICKED, "Clicked"),
    (STATUS_SPAM, "Spam"),
]

###############################################################################
# Constants — tracking events
###############################################################################

TRACK_OPEN = "open"
TRACK_CLICK = "click"
TRACK_BOUNCE = "bounce"
TRACK_SPAM = "spam"
TRACK_CHOICES = [
    (TRACK_OPEN, "Open"),
    (TRACK_CLICK, "Click"),
    (TRACK_BOUNCE, "Bounce"),
    (TRACK_SPAM, "Spam"),
]

###############################################################################
# Constants — mail-merge campaign status
###############################################################################

CAMPAIGN_DRAFT = "draft"
CAMPAIGN_RUNNING = "running"
CAMPAIGN_COMPLETED = "completed"
CAMPAIGN_FAILED = "failed"
CAMPAIGN_STATUS_CHOICES = [
    (CAMPAIGN_DRAFT, "Draft"),
    (CAMPAIGN_RUNNING, "Running"),
    (CAMPAIGN_COMPLETED, "Completed"),
    (CAMPAIGN_FAILED, "Failed"),
]


###############################################################################
# EmailAccount
###############################################################################


class EmailAccount(TenantModel):
    """A connected mailbox.

    ``credentials`` is a JSONField — the application layer is responsible
    for encrypting sensitive values (OAuth refresh tokens, IMAP passwords)
    before writing them, mirroring the pattern used by
    :class:`api.models.OAuthToken`. When ``FIELD_ENCRYPTION_KEY`` is set
    in the environment, callers should wrap the JSON payload with
    :class:`fernet_fields.fields.EncryptedJSONField` instead.
    """

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="email_accounts",
        db_index=True,
    )
    provider = models.CharField(
        max_length=32, choices=PROVIDER_CHOICES, default=PROVIDER_IMAP, db_index=True
    )
    email_address = models.EmailField(db_index=True)
    credentials = models.JSONField(
        default=dict,
        blank=True,
        help_text="Provider-specific credentials (OAuth tokens / IMAP host+password).",
    )
    sync_enabled = models.BooleanField(default=True, db_index=True)
    sync_frequency = models.PositiveIntegerField(
        default=2,
        help_text="Sync interval in minutes (used by the beat schedule fallback).",
    )
    last_synced_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        db_table = "email_integration_account"
        verbose_name = "email account"
        verbose_name_plural = "email accounts"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "user", "is_active"], name="email_acct_user_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.email_address} ({self.provider})"


###############################################################################
# EmailThread
###############################################################################


class EmailThread(TenantModel):
    """A grouped email conversation.

    Threads are derived by :func:`email_integration.services.thread_emails`
    — two emails join the same thread when their ``References`` header
    chain overlaps or their normalized subject matches.
    """

    subject = models.CharField(max_length=512, help_text="Normalized subject (Re:/Fwd: stripped).")
    related_module = models.CharField(max_length=64, blank=True, default="", db_index=True)
    related_id = models.CharField(max_length=64, blank=True, default="", db_index=True)
    last_activity_at = models.DateTimeField(default=timezone.now, db_index=True)
    email_count = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "email_integration_thread"
        verbose_name = "email thread"
        verbose_name_plural = "email threads"
        ordering = ["-last_activity_at"]
        indexes = [
            models.Index(fields=["tenant", "last_activity_at"], name="email_thread_recent_idx"),
            models.Index(
                fields=["tenant", "related_module", "related_id"],
                name="email_thread_record_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.subject} ({self.email_count})"


###############################################################################
# Email
###############################################################################


class Email(TenantModel):
    """A single RFC-822 message (inbound or outbound).

    The ``status`` field tracks the delivery lifecycle (``draft`` →
    ``queued`` → ``sent`` → ``delivered`` / ``bounced`` → ``opened`` /
    ``clicked`` / ``spam``). ``scheduled_at`` is set when the user opts
    for schedule-send — the ``send_scheduled_emails`` beat task picks it
    up and dispatches via SMTP. ``snoozed_until`` temporarily hides the
    email from the inbox view.
    """

    account = models.ForeignKey(
        EmailAccount,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="emails",
        db_index=True,
    )
    thread = models.ForeignKey(
        EmailThread,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="emails",
        db_index=True,
    )
    message_id = models.CharField(
        max_length=512,
        blank=True,
        default="",
        db_index=True,
        help_text="RFC-822 Message-ID header (used for de-dup on sync).",
    )
    from_address = models.EmailField(db_index=True)
    to_addresses = models.JSONField(default=list, blank=True)
    cc = models.JSONField(default=list, blank=True)
    bcc = models.JSONField(default=list, blank=True)
    subject = models.CharField(max_length=512, blank=True, default="")
    body_html = models.TextField(blank=True, default="")
    body_text = models.TextField(blank=True, default="")
    attachments = models.JSONField(default=list, blank=True)
    direction = models.CharField(
        max_length=16, choices=DIRECTION_CHOICES, default=DIRECTION_INBOUND, db_index=True
    )
    status = models.CharField(
        max_length=16, choices=STATUS_CHOICES, default=STATUS_DRAFT, db_index=True
    )
    related_module = models.CharField(max_length=64, blank=True, default="", db_index=True)
    related_id = models.CharField(max_length=64, blank=True, default="", db_index=True)
    is_starred = models.BooleanField(default=False, db_index=True)
    is_important = models.BooleanField(default=False)
    has_attachments = models.BooleanField(default=False)
    labels = models.JSONField(default=list, blank=True)
    received_at = models.DateTimeField(null=True, blank=True, db_index=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    opened_at = models.DateTimeField(null=True, blank=True)
    clicked_at = models.DateTimeField(null=True, blank=True)
    bounced_at = models.DateTimeField(null=True, blank=True)
    bounce_reason = models.TextField(blank=True, default="")
    scheduled_at = models.DateTimeField(null=True, blank=True, db_index=True)
    snoozed_until = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        db_table = "email_integration_email"
        verbose_name = "email"
        verbose_name_plural = "emails"
        ordering = ["-received_at", "-sent_at", "-created_at"]
        indexes = [
            models.Index(fields=["tenant", "thread", "received_at"], name="email_thread_recv_idx"),
            models.Index(fields=["tenant", "status"], name="email_status_idx"),
            models.Index(
                fields=["tenant", "related_module", "related_id"],
                name="email_record_idx",
            ),
            models.Index(fields=["tenant", "from_address"], name="email_from_idx"),
            models.Index(fields=["tenant", "is_starred"], name="email_starred_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.subject!s} → {self.from_address}"


###############################################################################
# EmailSignature
###############################################################################


class EmailSignature(TenantModel):
    """A per-user HTML signature. One default per user."""

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="email_signatures",
        db_index=True,
    )
    name = models.CharField(max_length=128)
    body_html = models.TextField(blank=True, default="")
    is_default = models.BooleanField(default=False, db_index=True)

    class Meta:
        db_table = "email_integration_signature"
        verbose_name = "email signature"
        verbose_name_plural = "email signatures"
        ordering = ["-is_default", "name"]
        unique_together = (("tenant", "user", "name"),)

    def __str__(self) -> str:
        return f"{self.user.email} — {self.name}"


###############################################################################
# EmailTracking
###############################################################################


class EmailTracking(TenantModel):
    """Append-only open / click / bounce / spam event log for an :class:`Email`."""

    email = models.ForeignKey(
        Email,
        on_delete=models.CASCADE,
        related_name="tracking_events",
        db_index=True,
    )
    event = models.CharField(max_length=16, choices=TRACK_CHOICES, db_index=True)
    url = models.CharField(max_length=2048, blank=True, default="")
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=512, blank=True, default="")
    timestamp = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        db_table = "email_integration_tracking"
        verbose_name = "email tracking event"
        verbose_name_plural = "email tracking events"
        ordering = ["-timestamp"]
        indexes = [
            models.Index(fields=["email", "timestamp"], name="email_track_ts_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.event} on email {self.email_id} @ {self.timestamp:%Y-%m-%d %H:%M}"


###############################################################################
# MailMergeCampaign
###############################################################################


class MailMergeCampaign(TenantModel):
    """A bulk send of a templated email to a list of recipients.

    ``recipients`` is a JSON list of ``{email, variables}`` objects. The
    ``send_mail_merge_campaign`` Celery task iterates the list, substitutes
    ``{{key}}`` placeholders in ``template_subject`` / ``template_body_html``
    with each recipient's ``variables``, and dispatches via SMTP.
    """

    name = models.CharField(max_length=255, db_index=True)
    template_subject = models.CharField(max_length=512)
    template_body_html = models.TextField(blank=True, default="")
    recipients = models.JSONField(default=list, blank=True)
    status = models.CharField(
        max_length=16,
        choices=CAMPAIGN_STATUS_CHOICES,
        default=CAMPAIGN_DRAFT,
        db_index=True,
    )
    sent_count = models.PositiveIntegerField(default=0)
    failed_count = models.PositiveIntegerField(default=0)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="mail_merge_campaigns",
    )

    class Meta:
        db_table = "email_integration_mail_merge"
        verbose_name = "mail merge campaign"
        verbose_name_plural = "mail merge campaigns"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "status"], name="email_mm_status_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.status})"


__all__ = [
    "CAMPAIGN_COMPLETED",
    "CAMPAIGN_DRAFT",
    "CAMPAIGN_FAILED",
    "CAMPAIGN_RUNNING",
    "CAMPAIGN_STATUS_CHOICES",
    "DIRECTION_CHOICES",
    "DIRECTION_INBOUND",
    "DIRECTION_OUTBOUND",
    "PROVIDER_CHOICES",
    "PROVIDER_CUSTOM",
    "PROVIDER_EXCHANGE",
    "PROVIDER_GMAIL",
    "PROVIDER_IMAP",
    "PROVIDER_OUTLOOK",
    "PROVIDER_YAHOO",
    "STATUS_BOUNCED",
    "STATUS_CLICKED",
    "STATUS_CHOICES",
    "STATUS_DELIVERED",
    "STATUS_DRAFT",
    "STATUS_OPENED",
    "STATUS_QUEUED",
    "STATUS_SENT",
    "STATUS_SPAM",
    "TRACK_BOUNCE",
    "TRACK_CHOICES",
    "TRACK_CLICK",
    "TRACK_OPEN",
    "TRACK_SPAM",
    "Email",
    "EmailAccount",
    "EmailSignature",
    "EmailThread",
    "EmailTracking",
    "MailMergeCampaign",
]
