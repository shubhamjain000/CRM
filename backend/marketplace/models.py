"""Database models for the marketplace app (Phase 19).

Two models:

* :class:`Extension` — the global catalog row. ``tenant`` is *nullable*
  so a single extension row is visible to every tenant. Inherits
  :class:`api.models.TimestampedModel` (not ``TenantModel``) precisely
  because the row is shared.
* :class:`InstalledExtension` — a tenant-scoped install record linking
  a tenant to an :class:`Extension`, with per-tenant ``config`` JSON and
  a ``status`` field. Inherits :class:`api.models.TenantModel`.
"""

from __future__ import annotations

from django.db import models

from api.models import Organization, TenantModel, TimestampedModel

PRICING_FREE = "free"
PRICING_PAID = "paid"
PRICING_FREEMIUM = "freemium"
PRICING_CHOICES = [
    (PRICING_FREE, "free"),
    (PRICING_PAID, "paid"),
    (PRICING_FREEMIUM, "freemium"),
]

STATUS_ACTIVE = "active"
STATUS_DISABLED = "disabled"
STATUS_ERROR = "error"
STATUS_CHOICES = [
    (STATUS_ACTIVE, "active"),
    (STATUS_DISABLED, "disabled"),
    (STATUS_ERROR, "error"),
]


class Extension(TimestampedModel):
    """A marketplace extension catalog row (global — tenant is nullable)."""

    tenant = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name="extensions",
        null=True,
        blank=True,
        db_index=True,
        help_text="Null for global catalog rows.",
    )
    name = models.CharField(max_length=255, db_index=True)
    developer = models.CharField(max_length=255, blank=True, default="")
    version = models.CharField(max_length=32, blank=True, default="1.0.0")
    description = models.TextField(blank=True, default="")
    category = models.CharField(max_length=64, blank=True, default="", db_index=True)
    pricing = models.CharField(max_length=16, choices=PRICING_CHOICES, default=PRICING_FREE)
    is_verified = models.BooleanField(default=False)
    is_featured = models.BooleanField(default=False)
    downloads = models.PositiveIntegerField(default=0)
    rating = models.FloatField(default=0.0)
    install_url = models.URLField(blank=True, default="")
    permissions = models.JSONField(default=list, blank=True)

    objects = models.Manager()

    class Meta:
        db_table = "marketplace_extension"
        verbose_name = "extension"
        verbose_name_plural = "extensions"
        ordering = ["-is_featured", "-rating", "-downloads"]
        indexes = [
            models.Index(fields=["category"], name="mp_ext_cat_idx"),
            models.Index(fields=["is_featured"], name="mp_ext_feat_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.name} v{self.version} ({self.developer})"


class InstalledExtension(TenantModel):
    """A tenant's install of an :class:`Extension`."""

    extension = models.ForeignKey(
        Extension,
        on_delete=models.CASCADE,
        related_name="installs",
    )
    config = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_ACTIVE)
    installed_at = models.DateTimeField(auto_now_add=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "marketplace_installedextension"
        verbose_name = "installed extension"
        verbose_name_plural = "installed extensions"
        unique_together = (("tenant", "extension"),)
        ordering = ["-installed_at"]

    def __str__(self) -> str:
        return f"{self.extension.name} @ {self.tenant.slug} ({self.status})"


__all__ = [
    "Extension",
    "InstalledExtension",
    "PRICING_CHOICES",
    "PRICING_FREE",
    "PRICING_PAID",
    "PRICING_FREEMIUM",
    "STATUS_ACTIVE",
    "STATUS_DISABLED",
    "STATUS_ERROR",
    "STATUS_CHOICES",
]
