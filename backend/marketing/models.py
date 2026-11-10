"""Database models for the marketing app (Phase 19).

Three tenant-scoped models: :class:`Campaign`, :class:`SubscriberList`,
:class:`MarketingEmail`.
"""

from __future__ import annotations

from django.db import models

from api.models import TenantModel

# Campaign type
C_EMAIL = "email"
C_SOCIAL = "social"
C_SMS = "sms"
CAMPAIGN_TYPE_CHOICES = [
    (C_EMAIL, "email"),
    (C_SOCIAL, "social"),
    (C_SMS, "sms"),
]

# Campaign status
C_DRAFT = "draft"
C_SCHEDULED = "scheduled"
C_RUNNING = "running"
C_COMPLETED = "completed"
CAMPAIGN_STATUS_CHOICES = [
    (C_DRAFT, "draft"),
    (C_SCHEDULED, "scheduled"),
    (C_RUNNING, "running"),
    (C_COMPLETED, "completed"),
]


class Campaign(TenantModel):
    """A tenant-scoped marketing campaign."""

    name = models.CharField(max_length=255, db_index=True)
    type = models.CharField(
        max_length=16, choices=CAMPAIGN_TYPE_CHOICES, default=C_EMAIL, db_index=True
    )
    status = models.CharField(
        max_length=16,
        choices=CAMPAIGN_STATUS_CHOICES,
        default=C_DRAFT,
        db_index=True,
    )
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    metrics = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "marketing_campaign"
        verbose_name = "campaign"
        verbose_name_plural = "campaigns"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "status"], name="cmp_status_idx"),
            models.Index(fields=["tenant", "type"], name="cmp_type_idx"),
        ]

    def __str__(self) -> str:
        return f"Campaign: {self.name} ({self.type})"


class SubscriberList(TenantModel):
    """A named tenant-scoped subscriber list."""

    name = models.CharField(max_length=255, db_index=True)
    subscriber_count = models.PositiveIntegerField(default=0)
    subscribers = models.JSONField(default=list, blank=True)

    class Meta:
        db_table = "marketing_subscriberlist"
        verbose_name = "subscriber list"
        verbose_name_plural = "subscriber lists"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"List: {self.name} ({self.subscriber_count})"


class MarketingEmail(TenantModel):
    """A sent marketing email tied to a :class:`Campaign`."""

    campaign = models.ForeignKey(
        Campaign,
        on_delete=models.CASCADE,
        related_name="emails",
    )
    subject = models.CharField(max_length=255)
    body_html = models.TextField(blank=True, default="")
    sent_count = models.PositiveIntegerField(default=0)
    open_count = models.PositiveIntegerField(default=0)
    click_count = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "marketing_marketingemail"
        verbose_name = "marketing email"
        verbose_name_plural = "marketing emails"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "campaign"], name="me_campaign_idx"),
        ]

    def __str__(self) -> str:
        return f"Email: {self.subject} (Campaign {self.campaign_id})"


__all__ = [
    "Campaign",
    "SubscriberList",
    "MarketingEmail",
    "C_EMAIL",
    "C_SOCIAL",
    "C_SMS",
    "CAMPAIGN_TYPE_CHOICES",
    "C_DRAFT",
    "C_SCHEDULED",
    "C_RUNNING",
    "C_COMPLETED",
    "CAMPAIGN_STATUS_CHOICES",
]
