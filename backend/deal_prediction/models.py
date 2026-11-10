"""Database models for the deal_prediction app (Phase 18).

One tenant-scoped model:

* :class:`PredictedDealValue` — the latest predicted expected-value +
  close-probability + expected-close-date for a (tenant, deal_id) pair.
  The composite index ``(tenant, deal_id)`` makes ``predict_deal`` +
  ``get_at_risk`` lookups O(1). ``factors`` carries the JSON breakdown
  (``{"amount": "...", "stage_probability": 0.5, "previous_probability":
  0.7}``) — ``get_at_risk`` uses ``previous_probability`` to detect
  week-over-week drops > 20%.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import TenantModel

MODEL_VERSION = "heuristic-v1"

# Probability-drop (relative) threshold that flags a deal as at-risk.
AT_RISK_DROP_THRESHOLD = 0.20


class PredictedDealValue(TenantModel):
    """Latest prediction row for a (tenant, deal_id) pair."""

    deal_id = models.CharField(max_length=32, db_index=True)
    expected_value = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    close_probability = models.FloatField(default=0.0)
    expected_close_date = models.DateField(null=True, blank=True, db_index=True)
    factors = models.JSONField(default=dict, blank=True)
    model_version = models.CharField(max_length=32, default=MODEL_VERSION)
    calculated_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        db_table = "deal_prediction_predicteddealvalue"
        verbose_name = "predicted deal value"
        verbose_name_plural = "predicted deal values"
        ordering = ["-calculated_at"]
        unique_together = (("tenant", "deal_id"),)
        indexes = [
            models.Index(fields=["tenant", "deal_id"], name="dp_deal_idx"),
            models.Index(fields=["tenant", "close_probability"], name="dp_prob_idx"),
        ]

    def __str__(self) -> str:
        return f"Deal {self.deal_id} → {self.close_probability:.0%} / ${self.expected_value}"


__all__ = ["AT_RISK_DROP_THRESHOLD", "MODEL_VERSION", "PredictedDealValue"]
