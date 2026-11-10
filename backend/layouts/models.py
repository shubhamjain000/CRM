"""Database models for the layouts app (Phase 17).

Two tenant-scoped models:

* :class:`Layout` — page layout for a (module, profile?) tuple.
  ``module`` is a string slug — one of the core CRM modules
  (``"lead"`` / ``"deal"`` / ``"contact"`` / ``"account"`` / ``"task"`` /
  ``"event"`` / ``"call"``) or a custom module's slug. ``profile`` is
  nullable (null = the module's default layout). ``config`` is a
  JSONField for advanced customisation (tab ordering, related-list
  placement, mobile vs desktop variants, etc.).
* :class:`LayoutSection` — a section inside a layout. ``fields`` is a
  JSON list of field ``api_name``s in display order.
"""

from __future__ import annotations

from django.db import models

from api.models import TenantModel

###############################################################################
# Constants — known core module keys
###############################################################################

MODULE_LEAD = "lead"
MODULE_DEAL = "deal"
MODULE_CONTACT = "contact"
MODULE_ACCOUNT = "account"
MODULE_TASK = "task"
MODULE_EVENT = "event"
MODULE_CALL = "call"
CORE_MODULE_KEYS = [
    MODULE_LEAD, MODULE_DEAL, MODULE_CONTACT, MODULE_ACCOUNT,
    MODULE_TASK, MODULE_EVENT, MODULE_CALL,
]


###############################################################################
# Layout
###############################################################################


class Layout(TenantModel):
    """A page layout for a (module, profile?) tuple.

    ``is_default`` marks the layout that applies when a profile has no
    explicit override (at most one default per module per tenant).
    """

    module = models.CharField(max_length=100, db_index=True)
    profile = models.ForeignKey(
        "profiles.Profile",
        on_delete=models.CASCADE,
        related_name="layouts",
        null=True,
        blank=True,
        db_index=True,
    )
    name = models.CharField(max_length=100)
    config = models.JSONField(default=dict, blank=True)
    is_default = models.BooleanField(default=False, db_index=True)

    class Meta:
        db_table = "layouts_layout"
        verbose_name = "layout"
        verbose_name_plural = "layouts"
        unique_together = (("tenant", "module", "profile", "name"),)
        indexes = [
            models.Index(fields=["tenant", "module", "is_default"], name="layout_default_idx"),
        ]

    def __str__(self) -> str:
        prof = f"/profile:{self.profile_id}" if self.profile_id else ""
        return f"{self.module}{prof}/{self.name}"


###############################################################################
# LayoutSection
###############################################################################


class LayoutSection(TenantModel):
    """A section inside a :class:`Layout`.

    ``fields`` is a JSON list of field ``api_name``s in display order.
    ``columns`` controls the section's column count (1 / 2 / 3).
    """

    layout = models.ForeignKey(
        Layout, on_delete=models.CASCADE, related_name="sections"
    )
    name = models.CharField(max_length=100)
    columns = models.PositiveIntegerField(default=1)
    order = models.IntegerField(default=0)
    is_collapsible = models.BooleanField(default=True)
    fields = models.JSONField(default=list, blank=True)

    class Meta:
        db_table = "layouts_section"
        verbose_name = "layout section"
        verbose_name_plural = "layout sections"
        ordering = ["order", "id"]
        indexes = [
            models.Index(fields=["layout", "order"], name="layout_sec_order_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.layout.name}/{self.name}"


__all__ = [
    "CORE_MODULE_KEYS",
    "Layout",
    "LayoutSection",
    "MODULE_ACCOUNT",
    "MODULE_CALL",
    "MODULE_CONTACT",
    "MODULE_DEAL",
    "MODULE_EVENT",
    "MODULE_LEAD",
    "MODULE_TASK",
]
