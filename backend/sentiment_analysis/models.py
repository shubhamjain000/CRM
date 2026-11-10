"""Database models for the sentiment_analysis app (Phase 18).

One tenant-scoped model:

* :class:`Sentiment` — a single sentiment row for a (tenant,
  record_module, record_id) triple. ``record_module`` is the polymorphic
  target (e.g. ``"lead"``, ``"deal"``, ``"email"``). ``sentiment`` ∈
  [-1, +1]; ``confidence`` ∈ [0, 1]. The composite index
  ``(tenant, record_module, record_id)`` makes :func:`get_trend` lookups
  O(log n) over time.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import TenantModel

MODEL_VERSION = "heuristic-v1"


class Sentiment(TenantModel):
    """Latest sentiment row for a (tenant, record_module, record_id) triple."""

    record_module = models.CharField(max_length=32, db_index=True)
    record_id = models.CharField(max_length=32, db_index=True)
    sentiment = models.FloatField(default=0.0)
    confidence = models.FloatField(default=0.0)
    model_version = models.CharField(max_length=32, default=MODEL_VERSION)
    analyzed_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        db_table = "sentiment_analysis_sentiment"
        verbose_name = "sentiment"
        verbose_name_plural = "sentiments"
        ordering = ["-analyzed_at"]
        indexes = [
            models.Index(
                fields=["tenant", "record_module", "record_id"],
                name="sent_record_idx",
            ),
            models.Index(fields=["tenant", "-analyzed_at"], name="sent_analyzed_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.record_module}:{self.record_id} → {self.sentiment:+.2f}"


__all__ = ["MODEL_VERSION", "Sentiment"]
