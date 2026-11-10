"""Database models for the canvas app (Phase 17).

A single tenant-scoped singleton :class:`CanvasTheme` defines the org's
visual identity. The unique constraint on ``tenant`` enforces the
one-row-per-tenant rule.
"""

from __future__ import annotations

from django.db import models

from api.models import TenantModel

###############################################################################
# Constants — density / sidebar style
###############################################################################

DENSITY_COMPACT = "compact"
DENSITY_COMFORTABLE = "comfortable"
DENSITY_COZY = "cozy"
DENSITY_CHOICES = [
    (DENSITY_COMPACT, "Compact"),
    (DENSITY_COMFORTABLE, "Comfortable"),
    (DENSITY_COZY, "Cozy"),
]

SIDEBAR_LIGHT = "light"
SIDEBAR_DARK = "dark"
SIDEBAR_COLORED = "colored"
SIDEBAR_STYLE_CHOICES = [
    (SIDEBAR_LIGHT, "Light"),
    (SIDEBAR_DARK, "Dark"),
    (SIDEBAR_COLORED, "Colored"),
]


###############################################################################
# CanvasTheme
###############################################################################


class CanvasTheme(TenantModel):
    """A singleton-per-tenant white-label theme.

    Enforced by ``unique_together = (("tenant",),)`` — at most one row
    per tenant. Created on first access via
    :func:`canvas.services.get_theme_for_tenant`.
    """

    primary_color = models.CharField(max_length=16, default="#0ea5e9")
    accent_color = models.CharField(max_length=16, default="#6366f1")
    font_family = models.CharField(max_length=100, default="Inter")
    border_radius = models.PositiveIntegerField(default=8)
    density = models.CharField(
        max_length=16, choices=DENSITY_CHOICES, default=DENSITY_COMFORTABLE
    )
    sidebar_style = models.CharField(
        max_length=16, choices=SIDEBAR_STYLE_CHOICES, default=SIDEBAR_LIGHT
    )
    logo_url = models.URLField(blank=True, default="")
    custom_css = models.TextField(blank=True, default="")

    class Meta:
        db_table = "canvas_theme"
        verbose_name = "canvas theme"
        verbose_name_plural = "canvas themes"
        # Enforce singleton-per-tenant.
        unique_together = (("tenant",),)

    def __str__(self) -> str:
        return f"CanvasTheme({self.tenant_id})"


__all__ = [
    "CanvasTheme",
    "DENSITY_CHOICES",
    "DENSITY_COMPACT",
    "DENSITY_COMFORTABLE",
    "DENSITY_COZY",
    "SIDEBAR_COLORED",
    "SIDEBAR_DARK",
    "SIDEBAR_LIGHT",
    "SIDEBAR_STYLE_CHOICES",
]
