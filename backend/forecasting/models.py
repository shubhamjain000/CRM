"""Database models for the forecasting app (Phase 16).

Two tenant-scoped models:

* :class:`Forecast` — a single (user, period_type, period_start,
  category) bucket. ``amount`` is auto-calculated from open deals;
  ``override_amount`` lets the rep / manager override it. Tracks
  submission (``submitted_at``) + approval (``approved_by`` /
  ``approved_at``).
* :class:`ForecastAdjustment` — append-only audit of every manual
  override.

Forecast categories mirror :mod:`deals.models_pipeline`:

* ``pipeline`` — early stages (default).
* ``best_case`` — negotiation / proposal stages.
* ``commit`` — rep is confident the deal will close in the period.
* ``closed`` — won deals.
* ``omitted`` — deals intentionally excluded from the forecast.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import TenantModel, User

###############################################################################
# Constants — period types + forecast categories
###############################################################################

PERIOD_WEEKLY = "weekly"
PERIOD_MONTHLY = "monthly"
PERIOD_QUARTERLY = "quarterly"
PERIOD_YEARLY = "yearly"
PERIOD_TYPE_CHOICES = [
    (PERIOD_WEEKLY, "Weekly"),
    (PERIOD_MONTHLY, "Monthly"),
    (PERIOD_QUARTERLY, "Quarterly"),
    (PERIOD_YEARLY, "Yearly"),
]

CATEGORY_PIPELINE = "pipeline"
CATEGORY_BEST_CASE = "best_case"
CATEGORY_COMMIT = "commit"
CATEGORY_CLOSED = "closed"
CATEGORY_OMITTED = "omitted"
CATEGORY_CHOICES = [
    (CATEGORY_PIPELINE, "Pipeline"),
    (CATEGORY_BEST_CASE, "Best Case"),
    (CATEGORY_COMMIT, "Commit"),
    (CATEGORY_CLOSED, "Closed"),
    (CATEGORY_OMITTED, "Omitted"),
]


###############################################################################
# Forecast
###############################################################################


class Forecast(TenantModel):
    """A single user × period × forecast-category bucket.

    ``amount`` is auto-calculated from the user's open deals via
    :func:`forecasting.services.calculate_forecast`. ``override_amount``
    is the manual override (nullable). When the forecast is submitted /
    approved the relevant timestamps are stamped.

    The effective forecast value is ``override_amount if override_amount
    is not None else amount``.
    """

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="forecasts",
        db_index=True,
    )
    period_type = models.CharField(
        max_length=16, choices=PERIOD_TYPE_CHOICES, default=PERIOD_MONTHLY, db_index=True
    )
    period_start = models.DateField(db_index=True)
    period_end = models.DateField(db_index=True)
    category = models.CharField(
        max_length=16, choices=CATEGORY_CHOICES, default=CATEGORY_PIPELINE, db_index=True
    )
    amount = models.DecimalField(
        max_digits=18, decimal_places=2, default=0,
        help_text="Auto-calculated from open deals.",
    )
    override_amount = models.DecimalField(
        max_digits=18, decimal_places=2, null=True, blank=True,
        help_text="Manual override (rep / manager). Null = use auto-calculated amount.",
    )
    notes = models.TextField(blank=True, default="")
    submitted_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="approved_forecasts",
        db_index=True,
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "forecasting_forecast"
        verbose_name = "forecast"
        verbose_name_plural = "forecasts"
        ordering = ["-period_start", "user", "category"]
        indexes = [
            models.Index(
                fields=["tenant", "user", "period_type", "period_start"],
                name="fc_user_period_idx",
            ),
            models.Index(fields=["tenant", "period_start"], name="fc_period_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} / {self.period_type} {self.period_start} / {self.category}"

    @property
    def effective_amount(self) -> "Decimal":
        """Return ``override_amount`` if set, else ``amount``."""
        from decimal import Decimal  # noqa: PLC0415

        if self.override_amount is not None:
            return self.override_amount
        return self.amount or Decimal(0)


###############################################################################
# ForecastAdjustment
###############################################################################


class ForecastAdjustment(TenantModel):
    """Append-only audit of every manual override on a :class:`Forecast`."""

    forecast = models.ForeignKey(
        Forecast,
        on_delete=models.CASCADE,
        related_name="adjustments",
        db_index=True,
    )
    adjusted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="forecast_adjustments",
        db_index=True,
    )
    old_amount = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    new_amount = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    reason = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        db_table = "forecasting_adjustment"
        verbose_name = "forecast adjustment"
        verbose_name_plural = "forecast adjustments"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["forecast", "created_at"], name="fc_adj_created_idx"),
        ]

    def __str__(self) -> str:
        return f"Forecast {self.forecast_id}: {self.old_amount} → {self.new_amount}"


__all__ = [
    "CATEGORY_BEST_CASE",
    "CATEGORY_CHOICES",
    "CATEGORY_CLOSED",
    "CATEGORY_COMMIT",
    "CATEGORY_OMITTED",
    "CATEGORY_PIPELINE",
    "Forecast",
    "ForecastAdjustment",
    "PERIOD_MONTHLY",
    "PERIOD_QUARTERLY",
    "PERIOD_TYPE_CHOICES",
    "PERIOD_WEEKLY",
    "PERIOD_YEARLY",
]
