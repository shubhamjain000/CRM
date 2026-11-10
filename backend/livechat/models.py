"""Database models for the livechat app.

All four models are tenant-scoped (inherit :class:`api.models.TenantModel`)
and follow the established pattern (TenantManager + TimestampedModel):

* :class:`ChatSession` — a single visitor ↔ agent conversation. Tracks
  visitor identity (id / name / email / phone / IP / geo / UA / pages
  visited / referrer), assignment to an agent, lifecycle status, an
  optional CRM-record link, satisfaction score, and a denormalized
  transcript snapshot.
* :class:`ChatMessage` — a single message in a session (visitor /
  agent / bot sender). Ordered by ``timestamp``.
* :class:`CannedResponse` — a reusable templated reply keyed by ``key``,
  grouped by ``category``.
* :class:`ProactiveRule` — a condition-driven proactive invitation rule
  (e.g. "visitor on /pricing > 30s → offer demo").
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import TenantModel, User

###############################################################################
# Constants — session status / message sender
###############################################################################

STATUS_WAITING = "waiting"
STATUS_ACTIVE = "active"
STATUS_ENDED = "ended"
SESSION_STATUS_CHOICES = [
    (STATUS_WAITING, "Waiting"),
    (STATUS_ACTIVE, "Active"),
    (STATUS_ENDED, "Ended"),
]

SENDER_VISITOR = "visitor"
SENDER_AGENT = "agent"
SENDER_BOT = "bot"
SENDER_CHOICES = [
    (SENDER_VISITOR, "Visitor"),
    (SENDER_AGENT, "Agent"),
    (SENDER_BOT, "Bot"),
]


###############################################################################
# ChatSession
###############################################################################


class ChatSession(TenantModel):
    """A single visitor ↔ agent chat session."""

    visitor_id = models.CharField(max_length=128, db_index=True)
    visitor_name = models.CharField(max_length=255, blank=True, default="")
    visitor_email = models.EmailField(blank=True, default="", db_index=True)
    visitor_phone = models.CharField(max_length=32, blank=True, default="")
    visitor_ip = models.GenericIPAddressField(null=True, blank=True)
    visitor_geo = models.JSONField(default=dict, blank=True, null=True)
    visitor_user_agent = models.CharField(max_length=512, blank=True, default="")
    pages_visited = models.JSONField(default=list, blank=True)
    referrer = models.URLField(blank=True, default="")
    assigned_to = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="chat_sessions",
        db_index=True,
    )
    status = models.CharField(
        max_length=16, choices=SESSION_STATUS_CHOICES, default=STATUS_WAITING, db_index=True
    )
    related_module = models.CharField(max_length=64, blank=True, default="", db_index=True)
    related_id = models.CharField(max_length=64, blank=True, default="", db_index=True)
    started_at = models.DateTimeField(default=timezone.now, db_index=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    satisfaction_score = models.PositiveSmallIntegerField(null=True, blank=True)
    transcript = models.TextField(blank=True, default="")

    class Meta:
        db_table = "livechat_session"
        verbose_name = "chat session"
        verbose_name_plural = "chat sessions"
        ordering = ["-started_at"]
        indexes = [
            models.Index(fields=["tenant", "status"], name="lc_session_status_idx"),
            models.Index(fields=["tenant", "assigned_to"], name="lc_session_assignee_idx"),
            models.Index(fields=["tenant", "visitor_email"], name="lc_session_email_idx"),
        ]

    def __str__(self) -> str:
        return f"ChatSession {self.pk} ({self.status})"


###############################################################################
# ChatMessage
###############################################################################


class ChatMessage(TenantModel):
    """A single message in a :class:`ChatSession`."""

    session = models.ForeignKey(
        ChatSession,
        on_delete=models.CASCADE,
        related_name="messages",
        db_index=True,
    )
    sender = models.CharField(max_length=16, choices=SENDER_CHOICES, default=SENDER_VISITOR)
    body = models.TextField()
    attachments = models.JSONField(default=list, blank=True)
    timestamp = models.DateTimeField(default=timezone.now, db_index=True)
    is_read = models.BooleanField(default=False, db_index=True)

    class Meta:
        db_table = "livechat_message"
        verbose_name = "chat message"
        verbose_name_plural = "chat messages"
        ordering = ["timestamp"]
        indexes = [
            models.Index(fields=["session", "timestamp"], name="lc_msg_session_ts_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.sender} @ {self.timestamp:%H:%M:%S}"


###############################################################################
# CannedResponse
###############################################################################


class CannedResponse(TenantModel):
    """A reusable templated reply."""

    key = models.CharField(max_length=128, db_index=True)
    body = models.TextField()
    category = models.CharField(max_length=64, blank=True, default="general", db_index=True)

    class Meta:
        db_table = "livechat_canned_response"
        verbose_name = "canned response"
        verbose_name_plural = "canned responses"
        ordering = ["category", "key"]
        indexes = [
            models.Index(fields=["tenant", "category"], name="lc_canned_cat_idx"),
        ]
        unique_together = (("tenant", "key"),)

    def __str__(self) -> str:
        return self.key


###############################################################################
# ProactiveRule
###############################################################################


class ProactiveRule(TenantModel):
    """A proactive-invitation rule (e.g. visitor idle on /pricing).

    ``conditions`` is a JSON list of ``{field, op, value}`` predicates
    evaluated against the visitor's session payload (pages visited,
    duration, referrer, geo, etc.). The first matching rule wins.
    """

    name = models.CharField(max_length=255)
    conditions = models.JSONField(default=list, blank=True)
    message = models.TextField()
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        db_table = "livechat_proactive_rule"
        verbose_name = "proactive rule"
        verbose_name_plural = "proactive rules"
        ordering = ["name"]
        indexes = [
            models.Index(fields=["tenant", "is_active"], name="lc_proactive_active_idx"),
        ]

    def __str__(self) -> str:
        return self.name


__all__ = [
    "ChatMessage",
    "ChatSession",
    "CannedResponse",
    "ProactiveRule",
    "SENDER_AGENT",
    "SENDER_BOT",
    "SENDER_CHOICES",
    "SENDER_VISITOR",
    "SESSION_STATUS_CHOICES",
    "STATUS_ACTIVE",
    "STATUS_ENDED",
    "STATUS_WAITING",
]
