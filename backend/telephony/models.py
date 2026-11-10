"""Database models for the telephony app.

All five models are tenant-scoped (inherit :class:`api.models.TenantModel`)
and follow the established pattern (TenantManager + TimestampedModel):

* :class:`PhoneNumber` — a number rented from a provider (Twilio / Exotel /
  Vonage / Plivo / MSG91) and assigned to a user, team, or IVR flow.
* :class:`TelephonyCall` — a single call leg (inbound / outbound / missed)
  with recording URL, transcription, sentiment, and CRM-record linkage.
* :class:`SmsTemplate` — a reusable SMS template with DLT compliance
  fields (``is_approved`` / ``dlt_template_id``) for the Indian market.
* :class:`SmsMessage` — an inbound or outbound SMS with delivery status
  and per-segment cost tracking.
* :class:`IvrFlow` — a visual call-flow configuration (JSON) attached to
  a :class:`PhoneNumber`.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import TenantModel

###############################################################################
# Constants — providers
###############################################################################

PROVIDER_TWILIO = "twilio"
PROVIDER_EXOTEL = "exotel"
PROVIDER_VONAGE = "vonage"
PROVIDER_PLIVO = "plivo"
PROVIDER_MSG91 = "msg91"
PROVIDER_CHOICES = [
    (PROVIDER_TWILIO, "Twilio"),
    (PROVIDER_EXOTEL, "Exotel"),
    (PROVIDER_VONAGE, "Vonage"),
    (PROVIDER_PLIVO, "Plivo"),
    (PROVIDER_MSG91, "MSG91"),
]

###############################################################################
# Constants — call direction / status / outcome
###############################################################################

CALL_INBOUND = "inbound"
CALL_OUTBOUND = "outbound"
CALL_MISSED = "missed"
CALL_DIRECTION_CHOICES = [
    (CALL_INBOUND, "Inbound"),
    (CALL_OUTBOUND, "Outbound"),
    (CALL_MISSED, "Missed"),
]

CALL_RINGING = "ringing"
CALL_IN_PROGRESS = "in_progress"
CALL_COMPLETED = "completed"
CALL_FAILED = "failed"
CALL_BUSY = "busy"
CALL_NO_ANSWER = "no_answer"
CALL_VOICEMAIL = "voicemail"
CALL_STATUS_CHOICES = [
    (CALL_RINGING, "Ringing"),
    (CALL_IN_PROGRESS, "In progress"),
    (CALL_COMPLETED, "Completed"),
    (CALL_FAILED, "Failed"),
    (CALL_BUSY, "Busy"),
    (CALL_NO_ANSWER, "No answer"),
    (CALL_VOICEMAIL, "Voicemail"),
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

###############################################################################
# Constants — SMS direction / status / category
###############################################################################

SMS_INBOUND = "inbound"
SMS_OUTBOUND = "outbound"
SMS_DIRECTION_CHOICES = [
    (SMS_INBOUND, "Inbound"),
    (SMS_OUTBOUND, "Outbound"),
]

SMS_QUEUED = "queued"
SMS_SENT = "sent"
SMS_DELIVERED = "delivered"
SMS_FAILED = "failed"
SMS_STATUS_CHOICES = [
    (SMS_QUEUED, "Queued"),
    (SMS_SENT, "Sent"),
    (SMS_DELIVERED, "Delivered"),
    (SMS_FAILED, "Failed"),
]

SMS_TRANSACTIONAL = "transactional"
SMS_PROMOTIONAL = "promotional"
SMS_OTP = "otp"
SMS_CATEGORY_CHOICES = [
    (SMS_TRANSACTIONAL, "Transactional"),
    (SMS_PROMOTIONAL, "Promotional"),
    (SMS_OTP, "OTP"),
]

###############################################################################
# Constants — phone number assignment
###############################################################################

ASSIGNED_TO_USER = "user"
ASSIGNED_TO_TEAM = "team"
ASSIGNED_TO_IVR = "ivr"
ASSIGNED_TO_CHOICES = [
    (ASSIGNED_TO_USER, "User"),
    (ASSIGNED_TO_TEAM, "Team"),
    (ASSIGNED_TO_IVR, "IVR"),
]


###############################################################################
# PhoneNumber
###############################################################################


class PhoneNumber(TenantModel):
    """A number rented from a provider and assigned to a user / team / IVR."""

    number = models.CharField(max_length=32, unique=True, db_index=True)
    provider = models.CharField(
        max_length=32, choices=PROVIDER_CHOICES, default=PROVIDER_TWILIO, db_index=True
    )
    capabilities = models.JSONField(
        default=dict,
        blank=True,
        help_text="Capability flags — e.g. {voice: true, sms: true, mms: false, whatsapp: true}.",
    )
    is_active = models.BooleanField(default=True, db_index=True)
    region = models.CharField(max_length=8, blank=True, default="")
    assigned_to_type = models.CharField(
        max_length=16, choices=ASSIGNED_TO_CHOICES, blank=True, default=""
    )
    assigned_to_id = models.CharField(max_length=64, blank=True, default="")
    friendly_name = models.CharField(max_length=128, blank=True, default="")

    class Meta:
        db_table = "telephony_phone_number"
        verbose_name = "phone number"
        verbose_name_plural = "phone numbers"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "is_active"], name="telephony_pn_active_idx"),
        ]

    def __str__(self) -> str:
        return self.friendly_name or self.number


###############################################################################
# TelephonyCall
###############################################################################


class TelephonyCall(TenantModel):
    """A single call leg with recording / transcription / sentiment / linkage.

    ``voip_provider`` + ``voip_call_id`` form the external reference key —
    webhooks from the provider match back to the row via this pair. The
    CRM-record linkage (``related_module`` / ``related_id``) lets the call
    log appear on the lead / contact / deal timeline.
    """

    from_number = models.CharField(max_length=32, db_index=True)
    to_number = models.CharField(max_length=32, db_index=True)
    direction = models.CharField(
        max_length=16, choices=CALL_DIRECTION_CHOICES, default=CALL_OUTBOUND, db_index=True
    )
    status = models.CharField(
        max_length=16, choices=CALL_STATUS_CHOICES, default=CALL_RINGING, db_index=True
    )
    duration = models.PositiveIntegerField(default=0, help_text="Call duration in seconds.")
    recording_url = models.URLField(max_length=2048, blank=True, default="")
    transcription = models.TextField(blank=True, default="")
    sentiment = models.CharField(
        max_length=16, choices=SENTIMENT_CHOICES, blank=True, default=""
    )
    related_module = models.CharField(max_length=64, blank=True, default="", db_index=True)
    related_id = models.CharField(max_length=64, blank=True, default="", db_index=True)
    owner_id = models.CharField(max_length=64, blank=True, default="", db_index=True)
    voip_provider = models.CharField(
        max_length=32, choices=PROVIDER_CHOICES, default=PROVIDER_TWILIO
    )
    voip_call_id = models.CharField(max_length=128, blank=True, default="", db_index=True)
    started_at = models.DateTimeField(default=timezone.now, db_index=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    outcome = models.CharField(
        max_length=16, choices=OUTCOME_CHOICES, blank=True, default=""
    )

    class Meta:
        db_table = "telephony_call"
        verbose_name = "telephony call"
        verbose_name_plural = "telephony calls"
        ordering = ["-started_at"]
        indexes = [
            models.Index(fields=["tenant", "started_at"], name="telephony_call_started_idx"),
            models.Index(
                fields=["tenant", "related_module", "related_id"],
                name="telephony_call_record_idx",
            ),
            models.Index(fields=["tenant", "owner_id"], name="telephony_call_owner_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.direction} {self.from_number}→{self.to_number} ({self.status})"


###############################################################################
# SmsTemplate
###############################################################################


class SmsTemplate(TenantModel):
    """A reusable SMS template.

    For the Indian market (DLT compliance), ``is_approved`` must be True
    and ``dlt_template_id`` must be set before the template may be used
    for outbound sends. The :func:`telephony.services.send_sms` helper
    enforces this gate.
    """

    name = models.CharField(max_length=128, db_index=True)
    body = models.TextField(help_text="Template body — use {{var}} placeholders.")
    variables = models.JSONField(default=list, blank=True)
    category = models.CharField(
        max_length=16, choices=SMS_CATEGORY_CHOICES, default=SMS_TRANSACTIONAL, db_index=True
    )
    is_approved = models.BooleanField(default=False, db_index=True)
    dlt_template_id = models.CharField(max_length=64, blank=True, default="")
    max_length = models.PositiveIntegerField(default=160)

    class Meta:
        db_table = "telephony_sms_template"
        verbose_name = "SMS template"
        verbose_name_plural = "SMS templates"
        ordering = ["name"]
        indexes = [
            models.Index(
                fields=["tenant", "category", "is_approved"],
                name="telephony_sms_tmpl_cat_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.category})"


###############################################################################
# SmsMessage
###############################################################################


class SmsMessage(TenantModel):
    """An inbound or outbound SMS with delivery status + per-segment cost."""

    from_number = models.CharField(max_length=32, db_index=True)
    to_number = models.CharField(max_length=32, db_index=True)
    body = models.TextField()
    direction = models.CharField(
        max_length=16, choices=SMS_DIRECTION_CHOICES, default=SMS_OUTBOUND, db_index=True
    )
    status = models.CharField(
        max_length=16, choices=SMS_STATUS_CHOICES, default=SMS_QUEUED, db_index=True
    )
    template = models.ForeignKey(
        SmsTemplate,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="messages",
        db_index=True,
    )
    related_module = models.CharField(max_length=64, blank=True, default="", db_index=True)
    related_id = models.CharField(max_length=64, blank=True, default="", db_index=True)
    segments = models.PositiveIntegerField(default=1)
    cost = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True, db_index=True)
    delivered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "telephony_sms_message"
        verbose_name = "SMS message"
        verbose_name_plural = "SMS messages"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "sent_at"], name="telephony_sms_sent_idx"),
            models.Index(fields=["tenant", "to_number"], name="telephony_sms_to_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.direction} {self.from_number}→{self.to_number} ({self.status})"


###############################################################################
# IvrFlow
###############################################################################


class IvrFlow(TenantModel):
    """A visual call-flow configuration attached to a :class:`PhoneNumber`.

    ``config`` is a JSON document describing the IVR tree (menus, prompts,
    routes to users / queues / external numbers). The shape is
    provider-agnostic; the service layer translates it to the provider's
    TwiML / XML at call time.
    """

    name = models.CharField(max_length=128, db_index=True)
    config = models.JSONField(
        default=dict,
        blank=True,
        help_text="Visual call-flow definition (menus, prompts, routes).",
    )
    phone_number = models.ForeignKey(
        PhoneNumber,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ivr_flows",
        db_index=True,
    )
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        db_table = "telephony_ivr_flow"
        verbose_name = "IVR flow"
        verbose_name_plural = "IVR flows"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "is_active"], name="telephony_ivr_active_idx"),
        ]

    def __str__(self) -> str:
        return self.name


__all__ = [
    "ASSIGNED_TO_CHOICES",
    "ASSIGNED_TO_IVR",
    "ASSIGNED_TO_TEAM",
    "ASSIGNED_TO_USER",
    "CALL_BUSY",
    "CALL_COMPLETED",
    "CALL_DIRECTION_CHOICES",
    "CALL_FAILED",
    "CALL_IN_PROGRESS",
    "CALL_INBOUND",
    "CALL_MISSED",
    "CALL_NO_ANSWER",
    "CALL_OUTBOUND",
    "CALL_RINGING",
    "CALL_STATUS_CHOICES",
    "CALL_VOICEMAIL",
    "OUTCOME_BUSY",
    "OUTCOME_CHOICES",
    "OUTCOME_CONNECTED",
    "OUTCOME_NO_ANSWER",
    "OUTCOME_VOICEMAIL",
    "PROVIDER_CHOICES",
    "PROVIDER_EXOTEL",
    "PROVIDER_MSG91",
    "PROVIDER_PLIVO",
    "PROVIDER_TWILIO",
    "PROVIDER_VONAGE",
    "SENTIMENT_CHOICES",
    "SENTIMENT_NEGATIVE",
    "SENTIMENT_NEUTRAL",
    "SENTIMENT_POSITIVE",
    "SMS_CATEGORY_CHOICES",
    "SMS_DELIVERED",
    "SMS_DIRECTION_CHOICES",
    "SMS_FAILED",
    "SMS_INBOUND",
    "SMS_OTP",
    "SMS_OUTBOUND",
    "SMS_PROMOTIONAL",
    "SMS_QUEUED",
    "SMS_SENT",
    "SMS_STATUS_CHOICES",
    "SMS_TRANSACTIONAL",
    "IvrFlow",
    "PhoneNumber",
    "SmsMessage",
    "SmsTemplate",
    "TelephonyCall",
]
