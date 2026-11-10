"""Database models for the smart_suggestions app (Phase 18).

One tenant-scoped model:

* :class:`SmartSuggestion` — a single actionable card for a user.
  ``suggestion_type`` ∈ {next_best_action, cross_sell, upsell,
  churn_risk, win_loss_predictor}; ``target_module`` / ``target_id``
  are the polymorphic target the card links to. ``priority`` is an int
  (higher = more important). ``is_dismissed`` / ``is_accepted`` are the
  two terminal lifecycle flags.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from api.models import TenantModel

TYPE_NEXT_BEST_ACTION = "next_best_action"
TYPE_CROSS_SELL = "cross_sell"
TYPE_UPSELL = "upsell"
TYPE_CHURN_RISK = "churn_risk"
TYPE_WIN_LOSS_PREDICTOR = "win_loss_predictor"
TYPE_CHOICES = [
    (TYPE_NEXT_BEST_ACTION, "Next Best Action"),
    (TYPE_CROSS_SELL, "Cross-Sell"),
    (TYPE_UPSELL, "Upsell"),
    (TYPE_CHURN_RISK, "Churn Risk"),
    (TYPE_WIN_LOSS_PREDICTOR, "Win/Loss Predictor"),
]


class SmartSuggestion(TenantModel):
    """A single actionable suggestion card for a user."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="smart_suggestions",
        db_index=True,
    )
    suggestion_type = models.CharField(
        max_length=32, choices=TYPE_CHOICES, default=TYPE_NEXT_BEST_ACTION, db_index=True
    )
    title = models.CharField(max_length=255)
    description = models.TextField(default="")
    target_module = models.CharField(max_length=32, default="")
    target_id = models.CharField(max_length=32, default="")
    priority = models.PositiveIntegerField(default=0)
    is_dismissed = models.BooleanField(default=False, db_index=True)
    is_accepted = models.BooleanField(default=False)

    class Meta:
        db_table = "smart_suggestions_smartsuggestion"
        verbose_name = "smart suggestion"
        verbose_name_plural = "smart suggestions"
        ordering = ["-priority", "-created_at"]
        indexes = [
            models.Index(
                fields=["tenant", "user", "is_dismissed"],
                name="ss_user_dismissed_idx",
            ),
            models.Index(
                fields=["tenant", "user", "suggestion_type"],
                name="ss_user_type_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.suggestion_type} / {self.title[:40]}"


__all__ = [
    "TYPE_CHOICES",
    "TYPE_CHURN_RISK",
    "TYPE_CROSS_SELL",
    "TYPE_NEXT_BEST_ACTION",
    "TYPE_UPSELL",
    "TYPE_WIN_LOSS_PREDICTOR",
    "SmartSuggestion",
]
