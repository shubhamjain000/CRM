"""Database models for the nlp_queries app (Phase 18).

One tenant-scoped model:

* :class:`NLPQuery` — a single natural-language question + the parsed
  query spec + the result summary. The composite index
  ``(tenant, user, -created_at)`` powers the per-user history endpoint.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from api.models import TenantModel


class NLPQuery(TenantModel):
    """A single NL question + parsed spec + result summary."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="nlp_queries",
        db_index=True,
    )
    question = models.TextField()
    generated_spec = models.JSONField(default=dict, blank=True)
    result_summary = models.TextField(blank=True, default="")

    class Meta:
        db_table = "nlp_queries_nlpquery"
        verbose_name = "NLP query"
        verbose_name_plural = "NLP queries"
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["tenant", "user", "-created_at"], name="nlp_user_created_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"NLP({self.user_id}): {self.question[:50]}"


__all__ = ["NLPQuery"]
