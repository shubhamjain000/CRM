"""Database models for the whatsapp app.

All three models are tenant-scoped (inherit :class:`api.models.TenantModel`)
and follow the established pattern (TenantManager + TimestampedModel):

* :class:`WhatsAppAccount` — a verified WhatsApp Business phone number bound
  to a WhatsApp Business Account (WABA) at Meta. ``access_token`` is stored
  as a plain ``TextField`` but should be encrypted at the application layer
  (see :mod:`api.models.OAuthToken` for the same convention).
* :class:`WhatsAppMessage` — a single inbound / outbound WhatsApp message
  with delivery lifecycle, CRM-record linkage, and per-message error tracking.
* :class:`WhatsAppTemplate` — a pre-approved Meta message template used for
  outbound broadcasts and transactional notifications.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import TenantModel

###############################################################################
# Constants — message type / direction / status / quality
###############################################################################

MSG_TEXT = "text"
MSG_IMAGE = "image"
MSG_VIDEO = "video"
MSG_DOCUMENT = "document"
MSG_AUDIO = "audio"
MSG_TEMPLATE = "template"
MSG_INTERACTIVE = "interactive"
MSG_LOCATION = "location"
MSG_CONTACTS = "contacts"
MSG_TYPE_CHOICES = [
    (MSG_TEXT, "Text"),
    (MSG_IMAGE, "Image"),
    (MSG_VIDEO, "Video"),
    (MSG_DOCUMENT, "Document"),
    (MSG_AUDIO, "Audio"),
    (MSG_TEMPLATE, "Template"),
    (MSG_INTERACTIVE, "Interactive"),
    (MSG_LOCATION, "Location"),
    (MSG_CONTACTS, "Contacts"),
]

DIR_INBOUND = "inbound"
DIR_OUTBOUND = "outbound"
DIR_CHOICES = [
    (DIR_INBOUND, "Inbound"),
    (DIR_OUTBOUND, "Outbound"),
]

ST_PENDING = "pending"
ST_SENT = "sent"
ST_DELIVERED = "delivered"
ST_READ = "read"
ST_FAILED = "failed"
ST_CHOICES = [
    (ST_PENDING, "Pending"),
    (ST_SENT, "Sent"),
    (ST_DELIVERED, "Delivered"),
    (ST_READ, "Read"),
    (ST_FAILED, "Failed"),
]

QUALITY_GREEN = "green"
QUALITY_YELLOW = "yellow"
QUALITY_RED = "red"
QUALITY_CHOICES = [
    (QUALITY_GREEN, "High quality"),
    (QUALITY_YELLOW, "Medium quality"),
    (QUALITY_RED, "Low quality"),
]


###############################################################################
# WhatsAppAccount
###############################################################################


class WhatsAppAccount(TenantModel):
    """A verified WhatsApp Business phone number.

    ``phone_number_id`` / ``waba_id`` are Meta's identifiers (the WABA
    is the WhatsApp Business Account container; the phone number is
    registered under it). ``access_token`` is the Meta Graph API token
    used to send messages — encrypted at the application layer, never
    serialized by the API (see :class:`whatsapp.serializers.WhatsAppAccountSerializer`).
    """

    phone_number_id = models.CharField(max_length=128, db_index=True)
    waba_id = models.CharField(max_length=128, blank=True, default="")
    access_token = models.TextField(
        help_text="Encrypted at the application layer; never serialized.",
    )
    display_name = models.CharField(max_length=255, blank=True, default="")
    display_phone_number = models.CharField(max_length=32, blank=True, default="", db_index=True)
    quality_rating = models.CharField(
        max_length=16, choices=QUALITY_CHOICES, blank=True, default=""
    )
    is_verified = models.BooleanField(default=False, db_index=True)
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        db_table = "whatsapp_account"
        verbose_name = "whatsapp account"
        verbose_name_plural = "whatsapp accounts"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "is_verified"], name="wa_acct_verified_idx"),
        ]

    def __str__(self) -> str:
        return self.display_phone_number or self.display_name or f"WA#{self.pk}"


###############################################################################
# WhatsAppMessage
###############################################################################


class WhatsAppMessage(TenantModel):
    """A single inbound or outbound WhatsApp message.

    ``related_module`` / ``related_id`` link the message back to a CRM
    record (Contact / Lead / Deal) — the same polymorphic-join pattern
    used by :class:`email_integration.models.Email`. ``media_file`` is
    an optional FK to a :class:`files.models.File` row for media messages.
    """

    account = models.ForeignKey(
        WhatsAppAccount,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="messages",
        db_index=True,
    )
    from_phone = models.CharField(max_length=32, db_index=True)
    to_phone = models.CharField(max_length=32, db_index=True)
    body = models.TextField(blank=True, default="")
    media_file = models.ForeignKey(
        "files.File",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="whatsapp_messages",
    )
    message_type = models.CharField(
        max_length=16, choices=MSG_TYPE_CHOICES, default=MSG_TEXT, db_index=True
    )
    status = models.CharField(
        max_length=16, choices=ST_CHOICES, default=ST_PENDING, db_index=True
    )
    direction = models.CharField(
        max_length=16, choices=DIR_CHOICES, default=DIR_OUTBOUND, db_index=True
    )
    related_module = models.CharField(max_length=64, blank=True, default="", db_index=True)
    related_id = models.CharField(max_length=64, blank=True, default="", db_index=True)
    template_id = models.CharField(max_length=128, blank=True, default="", db_index=True)
    error_code = models.CharField(max_length=32, blank=True, default="")
    error_message = models.TextField(blank=True, default="")
    timestamp = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        db_table = "whatsapp_message"
        verbose_name = "whatsapp message"
        verbose_name_plural = "whatsapp messages"
        ordering = ["-timestamp"]
        indexes = [
            models.Index(fields=["tenant", "from_phone", "timestamp"], name="wa_msg_from_ts_idx"),
            models.Index(
                fields=["tenant", "related_module", "related_id"],
                name="wa_msg_record_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.direction} {self.message_type} {self.from_phone}→{self.to_phone}"


###############################################################################
# WhatsAppTemplate
###############################################################################


class WhatsAppTemplate(TenantModel):
    """A pre-approved Meta message template.

    ``template_id`` is Meta's identifier (returned by the Graph API after
    submission). ``buttons`` is a JSON list of button specs in Meta's
    format (``{"type": "QUICK_REPLY", "text": "Yes"}`` etc).
    """

    name = models.CharField(max_length=255, db_index=True)
    language = models.CharField(max_length=16, default="en_US")
    category = models.CharField(max_length=64, blank=True, default="MARKETING")
    body = models.TextField()
    header_type = models.CharField(max_length=32, blank=True, default="")
    header_text = models.CharField(max_length=512, blank=True, default="")
    footer_text = models.CharField(max_length=512, blank=True, default="")
    buttons = models.JSONField(default=list, blank=True)
    is_approved = models.BooleanField(default=False, db_index=True)
    template_id = models.CharField(max_length=128, blank=True, default="", db_index=True)

    class Meta:
        db_table = "whatsapp_template"
        verbose_name = "whatsapp template"
        verbose_name_plural = "whatsapp templates"
        ordering = ["name"]
        indexes = [
            models.Index(fields=["tenant", "is_approved"], name="wa_tmpl_approved_idx"),
        ]
        unique_together = (("tenant", "name", "language"),)

    def __str__(self) -> str:
        return f"{self.name} ({self.language})"


__all__ = [
    "DIR_CHOICES",
    "DIR_INBOUND",
    "DIR_OUTBOUND",
    "MSG_AUDIO",
    "MSG_CONTACTS",
    "MSG_DOCUMENT",
    "MSG_IMAGE",
    "MSG_INTERACTIVE",
    "MSG_LOCATION",
    "MSG_TEMPLATE",
    "MSG_TEXT",
    "MSG_TYPE_CHOICES",
    "MSG_VIDEO",
    "QUALITY_CHOICES",
    "QUALITY_GREEN",
    "QUALITY_RED",
    "QUALITY_YELLOW",
    "ST_CHOICES",
    "ST_DELIVERED",
    "ST_FAILED",
    "ST_PENDING",
    "ST_READ",
    "ST_SENT",
    "WhatsAppAccount",
    "WhatsAppMessage",
    "WhatsAppTemplate",
]
