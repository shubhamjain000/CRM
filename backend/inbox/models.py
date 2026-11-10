"""Database models for the unified inbox app.

All three models are tenant-scoped (inherit :class:`api.models.TenantModel`)
and follow the established pattern (TenantManager + TimestampedModel):

* :class:`UnifiedConversation` — a cross-channel conversation thread.
  Each row is identified by ``(tenant, channel, external_id)`` — the
  ``external_id`` is the channel-native conversation handle (email
  thread ID, WhatsApp message group, chat session ID, social thread,
  call log ID, SMS thread). Conversations can be merged (``is_merged``
  flag + ``merged_into`` self-FK) and tracked against SLA deadlines.
* :class:`UnifiedMessage` — a single message in a conversation. The
  ``sender`` field distinguishes customer / agent / bot / system.
* :class:`InboxMacro` — a reusable automation macro (a JSON list of
  ``{type, params}`` actions executed by the ``execute`` viewset action).
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import TenantModel, User

###############################################################################
# Constants — channel / status / priority / sender
###############################################################################

CHANNEL_EMAIL = "email"
CHANNEL_WHATSAPP = "whatsapp"
CHANNEL_TELEPHONY = "telephony"
CHANNEL_LIVECHAT = "livechat"
CHANNEL_SOCIAL = "social"
CHANNEL_SMS = "sms"
CHANNEL_CHOICES = [
    (CHANNEL_EMAIL, "Email"),
    (CHANNEL_WHATSAPP, "WhatsApp"),
    (CHANNEL_TELEPHONY, "Telephony"),
    (CHANNEL_LIVECHAT, "Live chat"),
    (CHANNEL_SOCIAL, "Social"),
    (CHANNEL_SMS, "SMS"),
]

STATUS_OPEN = "open"
STATUS_PENDING = "pending"
STATUS_RESOLVED = "resolved"
STATUS_CLOSED = "closed"
STATUS_CHOICES = [
    (STATUS_OPEN, "Open"),
    (STATUS_PENDING, "Pending"),
    (STATUS_RESOLVED, "Resolved"),
    (STATUS_CLOSED, "Closed"),
]

PRIORITY_LOW = "low"
PRIORITY_NORMAL = "normal"
PRIORITY_HIGH = "high"
PRIORITY_URGENT = "urgent"
PRIORITY_CHOICES = [
    (PRIORITY_LOW, "Low"),
    (PRIORITY_NORMAL, "Normal"),
    (PRIORITY_HIGH, "High"),
    (PRIORITY_URGENT, "Urgent"),
]

SENDER_CUSTOMER = "customer"
SENDER_AGENT = "agent"
SENDER_BOT = "bot"
SENDER_SYSTEM = "system"
SENDER_CHOICES = [
    (SENDER_CUSTOMER, "Customer"),
    (SENDER_AGENT, "Agent"),
    (SENDER_BOT, "Bot"),
    (SENDER_SYSTEM, "System"),
]


###############################################################################
# UnifiedConversation
###############################################################################


class UnifiedConversation(TenantModel):
    """A cross-channel conversation thread.

    ``external_id`` is the channel-native handle — email thread ID,
    WhatsApp message group, chat session ID, social thread ID, call
    log ID, SMS recipient+sender pair, etc. ``participant_identifier``
    is the canonical customer address (email / phone / handle).
    """

    channel = models.CharField(max_length=32, choices=CHANNEL_CHOICES, db_index=True)
    external_id = models.CharField(max_length=255, db_index=True)
    subject = models.CharField(max_length=512, blank=True, default="")
    participant_name = models.CharField(max_length=255, blank=True, default="")
    participant_identifier = models.CharField(max_length=255, blank=True, default="", db_index=True)
    assigned_to = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="inbox_conversations",
        db_index=True,
    )
    status = models.CharField(
        max_length=16, choices=STATUS_CHOICES, default=STATUS_OPEN, db_index=True
    )
    priority = models.CharField(
        max_length=16, choices=PRIORITY_CHOICES, default=PRIORITY_NORMAL, db_index=True
    )
    sla_response_deadline = models.DateTimeField(null=True, blank=True)
    sla_resolution_deadline = models.DateTimeField(null=True, blank=True)
    tags = models.JSONField(default=list, blank=True)
    internal_notes = models.JSONField(default=list, blank=True)
    related_module = models.CharField(max_length=64, blank=True, default="", db_index=True)
    related_id = models.CharField(max_length=64, blank=True, default="", db_index=True)
    is_merged = models.BooleanField(default=False, db_index=True)
    merged_into = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="merged_children",
        db_index=True,
    )
    last_message_at = models.DateTimeField(default=timezone.now, db_index=True)
    message_count = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "inbox_conversation"
        verbose_name = "unified conversation"
        verbose_name_plural = "unified conversations"
        ordering = ["-last_message_at"]
        indexes = [
            models.Index(fields=["tenant", "channel", "status"], name="inbox_conv_chan_idx"),
            models.Index(fields=["tenant", "assigned_to"], name="inbox_conv_assignee_idx"),
            models.Index(fields=["tenant", "last_message_at"], name="inbox_conv_lastmsg_idx"),
        ]
        unique_together = (("tenant", "channel", "external_id"),)

    def __str__(self) -> str:
        return f"{self.channel}/{self.external_id} ({self.status})"


###############################################################################
# UnifiedMessage
###############################################################################


class UnifiedMessage(TenantModel):
    """A single message in a :class:`UnifiedConversation`."""

    conversation = models.ForeignKey(
        UnifiedConversation,
        on_delete=models.CASCADE,
        related_name="messages",
        db_index=True,
    )
    channel = models.CharField(max_length=32, choices=CHANNEL_CHOICES, db_index=True)
    sender = models.CharField(
        max_length=16, choices=SENDER_CHOICES, default=SENDER_CUSTOMER, db_index=True
    )
    body = models.TextField()
    attachments = models.JSONField(default=list, blank=True)
    timestamp = models.DateTimeField(default=timezone.now, db_index=True)
    is_read = models.BooleanField(default=False, db_index=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "inbox_message"
        verbose_name = "unified message"
        verbose_name_plural = "unified messages"
        ordering = ["timestamp"]
        indexes = [
            models.Index(fields=["conversation", "timestamp"], name="inbox_msg_conv_ts_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.sender} @ {self.timestamp:%Y-%m-%d %H:%M}"


###############################################################################
# InboxMacro
###############################################################################


class InboxMacro(TenantModel):
    """A reusable automation macro — a JSON list of ``{type, params}`` actions.

    Recognized action types (executed by :func:`inbox.services.execute_macro`):
    * ``{"type": "assign", "params": {"user_id": 42}}``
    * ``{"type": "set_status", "params": {"status": "resolved"}}``
    * ``{"type": "set_priority", "params": {"priority": "high"}}``
    * ``{"type": "add_tag", "params": {"tag": "vip"}}``
    * ``{"type": "send_reply", "params": {"body": "..."}}``
    """

    name = models.CharField(max_length=255)
    actions = models.JSONField(default=list, blank=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="inbox_macros",
        db_index=True,
    )

    class Meta:
        db_table = "inbox_macro"
        verbose_name = "inbox macro"
        verbose_name_plural = "inbox macros"
        ordering = ["name"]
        indexes = [
            models.Index(fields=["tenant"], name="inbox_macro_tenant_idx"),
        ]
        unique_together = (("tenant", "name"),)

    def __str__(self) -> str:
        return self.name


__all__ = [
    "CHANNEL_CHOICES",
    "CHANNEL_EMAIL",
    "CHANNEL_LIVECHAT",
    "CHANNEL_SOCIAL",
    "CHANNEL_SMS",
    "CHANNEL_TELEPHONY",
    "CHANNEL_WHATSAPP",
    "InboxMacro",
    "PRIORITY_CHOICES",
    "PRIORITY_HIGH",
    "PRIORITY_LOW",
    "PRIORITY_NORMAL",
    "PRIORITY_URGENT",
    "SENDER_AGENT",
    "SENDER_BOT",
    "SENDER_CHOICES",
    "SENDER_CUSTOMER",
    "SENDER_SYSTEM",
    "STATUS_CHOICES",
    "STATUS_CLOSED",
    "STATUS_OPEN",
    "STATUS_PENDING",
    "STATUS_RESOLVED",
    "UnifiedConversation",
    "UnifiedMessage",
]
