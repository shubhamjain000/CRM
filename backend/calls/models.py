"""Call model — VoIP call log with transcription + sentiment.

Design notes
------------
* Inherits :class:`api.soft_delete.SoftDeleteTenantModel` → tenant FK
  (``CASCADE``), ``created_at`` / ``updated_at``, ``deleted_at``, and the
  soft-delete-aware ``objects`` / ``all_objects`` managers.
* ``attendees`` is a M2M to :class:`api.models.User` recording who was on the
  call (typically the agent + any internal participants).
* ``related_module`` / ``related_id`` link the call to a CRM record (lead /
  contact / account / deal). The ``post_save`` signal writes a ``called``
  activity on that record.
* ``voip_provider`` / ``voip_call_id`` track the external provider's call
  reference (e.g. Twilio Call SID) so webhooks can be matched to the row.
* ``sentiment`` is filled by an AI worker post-call (positive / neutral /
  negative); ``transcription`` holds the speech-to-text output.
"""

from __future__ import annotations

from django.db import models

from api.models import User
from api.soft_delete import SoftDeleteTenantModel


class Call(SoftDeleteTenantModel):
    """A VoIP call log entry."""

    CALL_TYPE_INBOUND = "inbound"
    CALL_TYPE_OUTBOUND = "outbound"
    CALL_TYPE_MISSED = "missed"
    CALL_TYPE_CHOICES = [
        (CALL_TYPE_INBOUND, "Inbound"),
        (CALL_TYPE_OUTBOUND, "Outbound"),
        (CALL_TYPE_MISSED, "Missed"),
    ]

    OUTCOME_CONNECTED = "connected"
    OUTCOME_VOICEMAIL = "voicemail"
    OUTCOME_NO_ANSWER = "no_answer"
    OUTCOME_BUSY = "busy"
    OUTCOME_CHOICES = [
        (OUTCOME_CONNECTED, "Connected"),
        (OUTCOME_VOICEMAIL, "Voicemail"),
        (OUTCOME_NO_ANSWER, "No answer"),
        (OUTCOME_BUSY, "Busy"),
    ]

    SENTIMENT_POSITIVE = "positive"
    SENTIMENT_NEUTRAL = "neutral"
    SENTIMENT_NEGATIVE = "negative"
    SENTIMENT_CHOICES = [
        (SENTIMENT_POSITIVE, "Positive"),
        (SENTIMENT_NEUTRAL, "Neutral"),
        (SENTIMENT_NEGATIVE, "Negative"),
    ]

    subject = models.CharField(max_length=255)
    call_type = models.CharField(
        max_length=16,
        choices=CALL_TYPE_CHOICES,
        default=CALL_TYPE_OUTBOUND,
        db_index=True,
    )
    duration = models.BigIntegerField(
        default=0,
        help_text="Call duration in seconds.",
    )
    outcome = models.CharField(
        max_length=16,
        choices=OUTCOME_CHOICES,
        default=OUTCOME_CONNECTED,
        db_index=True,
    )
    recording_url = models.URLField(max_length=1024, blank=True, default="")
    transcription = models.TextField(blank=True, default="")
    sentiment = models.CharField(
        max_length=16,
        choices=SENTIMENT_CHOICES,
        blank=True,
        default="",
        db_index=True,
    )
    attendees = models.ManyToManyField(
        User,
        related_name="calls",
        blank=True,
    )
    related_module = models.CharField(
        max_length=32,
        blank=True,
        default="",
        db_index=True,
        help_text="CRM module this call relates to (lead/contact/account/deal) if any.",
    )
    related_id = models.CharField(
        max_length=64,
        blank=True,
        default="",
        db_index=True,
    )
    voip_provider = models.CharField(max_length=64, blank=True, default="")
    voip_call_id = models.CharField(
        max_length=255,
        blank=True,
        default="",
        db_index=True,
        help_text="External provider's call ID (e.g. Twilio Call SID).",
    )
    notes = models.TextField(blank=True, default="")
    started_at = models.DateTimeField(db_index=True)
    ended_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="logged_calls",
    )

    class Meta:
        db_table = "calls_call"
        verbose_name = "call"
        verbose_name_plural = "calls"
        ordering = ["-started_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(call_type__in=("inbound", "outbound", "missed")),
                name="calls_call_type_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(outcome__in=("connected", "voicemail", "no_answer", "busy")),
                name="calls_outcome_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(sentiment__in=("positive", "neutral", "negative", "")),
                name="calls_sentiment_valid",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "deleted_at"], name="calls_tenant_deleted_idx"),
            models.Index(fields=["tenant", "started_at"], name="calls_tenant_started_idx"),
            models.Index(
                fields=["tenant", "related_module", "related_id"],
                name="calls_tenant_related_idx",
            ),
            models.Index(fields=["tenant", "voip_call_id"], name="calls_voip_call_id_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.call_type} call: {self.subject} @ {self.started_at:%Y-%m-%d %H:%M}"

    @property
    def duration_minutes(self) -> float:
        """Return the call duration in minutes (float)."""
        return (self.duration or 0) / 60.0
