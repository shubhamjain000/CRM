"""Database models for the territories app (Phase 17).

Two tenant-scoped models:

* :class:`Territory` — a named territory with ``rules`` (JSON), a
  ``manager`` (User, nullable), and a self-referential ``parent`` for
  nested hierarchies. ``rules`` is interpreted by
  :func:`territories.services.realign_territory` — see that module for
  the supported rule schema.
* :class:`TerritoryMember` — a (territory, user) pair. A user may
  belong to multiple territories.
"""

from __future__ import annotations

from django.db import models

from api.models import TenantModel, User


###############################################################################
# Territory
###############################################################################


class Territory(TenantModel):
    """A named territory.

    ``rules`` is a JSONField encoding the assignment criteria. Schema::

        {
            "module": "lead" | "account" | "deal",
            "filters": {"field": "value", ...},
            "strategy": "round_robin" | "load_balance" | "all_to_manager"
        }

    See :func:`territories.services.realign_territory` for the runtime
    that interprets this.
    """

    name = models.CharField(max_length=100, db_index=True)
    rules = models.JSONField(default=dict, blank=True)
    manager = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="managed_territories",
        null=True,
        blank=True,
    )
    parent = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        related_name="children",
        null=True,
        blank=True,
        db_index=True,
    )
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        db_table = "territories_territory"
        verbose_name = "territory"
        verbose_name_plural = "territories"
        unique_together = (("tenant", "name"),)
        indexes = [
            models.Index(fields=["tenant", "is_active"], name="territory_active_idx"),
        ]

    def __str__(self) -> str:
        return self.name


###############################################################################
# TerritoryMember
###############################################################################


class TerritoryMember(TenantModel):
    """A (territory, user) membership pair."""

    territory = models.ForeignKey(
        Territory, on_delete=models.CASCADE, related_name="members"
    )
    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="territory_memberships"
    )

    class Meta:
        db_table = "territories_member"
        verbose_name = "territory member"
        verbose_name_plural = "territory members"
        unique_together = (("territory", "user"),)
        indexes = [
            models.Index(fields=["territory", "user"], name="tm_pair_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.territory.name}/{self.user.email}"


__all__ = ["Territory", "TerritoryMember"]
