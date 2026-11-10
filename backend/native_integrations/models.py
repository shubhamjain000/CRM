"""Database models for the native_integrations app (Phase 19).

Two tenant-scoped models: :class:`Integration`, :class:`IntegrationLog`.

The ``PROVIDER_CHOICES`` tuple lists every supported external provider
identifier. New providers should be added here (and only here) — the
viewset + serializer are choice-agnostic and pick up new entries
automatically.
"""

from __future__ import annotations

from django.db import models

from api.models import TenantModel

PROVIDER_GOOGLE = "google_workspace"
PROVIDER_MS365 = "microsoft_365"
PROVIDER_SLACK = "slack"
PROVIDER_ZOOM = "zoom"
PROVIDER_MAILCHIMP = "mailchimp"
PROVIDER_QUICKBOOKS = "quickbooks"
PROVIDER_STRIPE = "stripe"
PROVIDER_RAZORPAY = "razorpay"
PROVIDER_DOCUSIGN = "docusign"
PROVIDER_CLEARBIT = "clearbit"
PROVIDER_HUNTER = "hunter"
PROVIDER_CALENDLY = "calendly"
PROVIDER_ZAPIER = "zapier"

PROVIDER_CHOICES = [
    (PROVIDER_GOOGLE, "google_workspace"),
    (PROVIDER_MS365, "microsoft_365"),
    (PROVIDER_SLACK, "slack"),
    (PROVIDER_ZOOM, "zoom"),
    (PROVIDER_MAILCHIMP, "mailchimp"),
    (PROVIDER_QUICKBOOKS, "quickbooks"),
    (PROVIDER_STRIPE, "stripe"),
    (PROVIDER_RAZORPAY, "razorpay"),
    (PROVIDER_DOCUSIGN, "docusign"),
    (PROVIDER_CLEARBIT, "clearbit"),
    (PROVIDER_HUNTER, "hunter"),
    (PROVIDER_CALENDLY, "calendly"),
    (PROVIDER_ZAPIER, "zapier"),
]

# Log status
LOG_OK = "ok"
LOG_ERROR = "error"
LOG_INFO = "info"
LOG_STATUS_CHOICES = [
    (LOG_OK, "ok"),
    (LOG_ERROR, "error"),
    (LOG_INFO, "info"),
]


class Integration(TenantModel):
    """A tenant's connection to an external provider."""

    provider = models.CharField(
        max_length=32, choices=PROVIDER_CHOICES, db_index=True
    )
    is_connected = models.BooleanField(default=False, db_index=True)
    config = models.JSONField(default=dict, blank=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "native_integrations_integration"
        verbose_name = "integration"
        verbose_name_plural = "integrations"
        ordering = ["-created_at"]
        unique_together = (("tenant", "provider"),)
        indexes = [
            models.Index(fields=["tenant", "provider"], name="ni_provider_idx"),
            models.Index(fields=["tenant", "is_connected"], name="ni_conn_idx"),
        ]

    def __str__(self) -> str:
        flag = "connected" if self.is_connected else "disconnected"
        return f"{self.provider} @ {self.tenant.slug} ({flag})"


class IntegrationLog(TenantModel):
    """An append-only log row for an :class:`Integration`."""

    integration = models.ForeignKey(
        Integration,
        on_delete=models.CASCADE,
        related_name="logs",
    )
    event = models.CharField(max_length=128, db_index=True)
    status = models.CharField(
        max_length=16, choices=LOG_STATUS_CHOICES, default=LOG_INFO, db_index=True
    )
    details = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "native_integrations_integrationlog"
        verbose_name = "integration log"
        verbose_name_plural = "integration logs"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "integration"], name="il_int_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.event} ({self.status}) on {self.integration_id}"


__all__ = [
    "Integration",
    "IntegrationLog",
    "PROVIDER_GOOGLE",
    "PROVIDER_MS365",
    "PROVIDER_SLACK",
    "PROVIDER_ZOOM",
    "PROVIDER_MAILCHIMP",
    "PROVIDER_QUICKBOOKS",
    "PROVIDER_STRIPE",
    "PROVIDER_RAZORPAY",
    "PROVIDER_DOCUSIGN",
    "PROVIDER_CLEARBIT",
    "PROVIDER_HUNTER",
    "PROVIDER_CALENDLY",
    "PROVIDER_ZAPIER",
    "PROVIDER_CHOICES",
    "LOG_OK",
    "LOG_ERROR",
    "LOG_INFO",
    "LOG_STATUS_CHOICES",
]
