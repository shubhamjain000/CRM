"""Database models for the ai_writer app (Phase 18).

One tenant-scoped model:

* :class:`AIWriterDraft` — a single generated draft. ``draft_type`` ∈
  {email, blog, social, summary, proposal}; ``style`` + ``tone`` carry
  the caller's generation parameters. ``prompt`` is the original ask,
  ``generated_content`` is the LLM response.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from api.models import TenantModel

DRAFT_EMAIL = "email"
DRAFT_BLOG = "blog"
DRAFT_SOCIAL = "social"
DRAFT_SUMMARY = "summary"
DRAFT_PROPOSAL = "proposal"
DRAFT_TYPE_CHOICES = [
    (DRAFT_EMAIL, "Email"),
    (DRAFT_BLOG, "Blog"),
    (DRAFT_SOCIAL, "Social"),
    (DRAFT_SUMMARY, "Summary"),
    (DRAFT_PROPOSAL, "Proposal"),
]


class AIWriterDraft(TenantModel):
    """A single AI-generated content draft."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="ai_writer_drafts",
        db_index=True,
    )
    draft_type = models.CharField(
        max_length=16, choices=DRAFT_TYPE_CHOICES, default=DRAFT_EMAIL, db_index=True
    )
    prompt = models.TextField(default="")
    generated_content = models.TextField(default="")
    style = models.CharField(max_length=32, default="professional")
    tone = models.CharField(max_length=32, default="friendly")

    class Meta:
        db_table = "ai_writer_draft"
        verbose_name = "AI writer draft"
        verbose_name_plural = "AI writer drafts"
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["tenant", "user", "-created_at"], name="aiw_user_created_idx"
            ),
            models.Index(
                fields=["tenant", "draft_type", "-created_at"], name="aiw_type_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.draft_type} / {self.prompt[:40]}"


__all__ = [
    "AIWriterDraft",
    "DRAFT_BLOG",
    "DRAFT_EMAIL",
    "DRAFT_PROPOSAL",
    "DRAFT_SOCIAL",
    "DRAFT_SUMMARY",
    "DRAFT_TYPE_CHOICES",
]
