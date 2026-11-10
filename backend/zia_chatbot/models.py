"""Database models for the zia_chatbot app (Phase 18).

One tenant-scoped model:

* :class:`ZiaConversation` — a per-user conversation thread. ``messages``
  is a JSON list of ``{role: "user"|"assistant"|"tool", content, timestamp,
  tool_calls?}`` dicts. The composite index ``(tenant, user, -updated_at)``
  powers the per-user history endpoint. Exactly one conversation per
  ``(tenant, user)`` is enforced by ``unique_together``.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from api.models import TenantModel

# System prompt sent ahead of every chat — describes the CRM schema +
# the available function-calling tools the assistant can invoke.
SYSTEM_PROMPT = (
    "You are Zia, an in-CRM assistant. You can answer questions about "
    "leads, deals, accounts, contacts, tasks, and reports. You have "
    "access to function-calling tools: search_records(module, query), "
    "create_task(title, due_date), score_lead(lead_id), predict_deal("
    "deal_id), generate_suggestions(user_id). Always confirm before "
    "writing data."
)


class ZiaConversation(TenantModel):
    """A per-user conversation thread."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="zia_conversations",
        db_index=True,
    )
    messages = models.JSONField(default=list, blank=True)

    class Meta:
        db_table = "zia_chatbot_ziaconversation"
        verbose_name = "Zia conversation"
        verbose_name_plural = "Zia conversations"
        ordering = ["-updated_at"]
        unique_together = (("tenant", "user"),)
        indexes = [
            models.Index(
                fields=["tenant", "user", "-updated_at"],
                name="zia_user_updated_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"Zia({self.user_id}): {len(self.messages)} messages"


__all__ = ["SYSTEM_PROMPT", "ZiaConversation"]
