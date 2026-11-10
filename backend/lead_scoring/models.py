"""Database models for the lead_scoring app (Phase 18).

One tenant-scoped model:

* :class:`LeadScore` — the latest computed score for a (tenant, lead_id)
  pair. The composite index ``(tenant, lead_id)`` makes ``get_hot_leads``
  + ``score_lead`` lookups O(1). ``factors`` is the JSON breakdown that
  the scoring service returns (e.g. ``{"has_email": 5, "has_phone": 5,
  "company_match": 20, "revenue_tier": 30, "source_weight": 10}``).
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import TenantModel

# Current scoring-model version — bumped when the heuristic changes so
# callers can re-score stale rows.
MODEL_VERSION = "heuristic-v1"


class LeadScore(TenantModel):
    """Latest score for a (tenant, lead_id) pair."""

    lead_id = models.CharField(max_length=32, db_index=True)
    score = models.PositiveIntegerField(default=0)
    factors = models.JSONField(default=dict, blank=True)
    model_version = models.CharField(max_length=32, default=MODEL_VERSION)
    calculated_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        db_table = "lead_scoring_leadscore"
        verbose_name = "lead score"
        verbose_name_plural = "lead scores"
        ordering = ["-score", "-calculated_at"]
        unique_together = (("tenant", "lead_id"),)
        indexes = [
            models.Index(fields=["tenant", "lead_id"], name="ls_lead_idx"),
            models.Index(fields=["tenant", "-score"], name="ls_score_idx"),
        ]

    def __str__(self) -> str:
        return f"Lead {self.lead_id} → {self.score}"


__all__ = ["MODEL_VERSION", "LeadScore"]
