"""Database models for the ai_core app (Phase 18).

Two tenant-scoped models:

* :class:`AICostLog` — append-only ledger of every LLM invocation. Each
  row records (tenant, model, input_tokens, output_tokens, cost,
  task_type, created_at). The hourly / daily / monthly tenant cost is
  the ``Sum(cost)`` over this table.
* :class:`PromptTemplate` — a versioned (name, version) prompt pair.
  Exactly one row per ``(tenant, name)`` is ``is_active=True`` (enforced
  in :func:`ai_core.services.activate_template`). Downstream services
  fetch the active template by name and pass its system + user-prompt
  template to :func:`ai_core.services.call_llm`.
"""

from __future__ import annotations

from decimal import Decimal

from django.db import models
from django.utils import timezone

from api.models import TenantModel

###############################################################################
# Constants — task types + model registry
###############################################################################

TASK_CHAT = "chat"
TASK_SUMMARY = "summary"
TASK_SENTIMENT = "sentiment"
TASK_LEAD_SCORE = "lead_score"
TASK_DEAL_PREDICT = "deal_predict"
TASK_EMAIL_DRAFT = "email_draft"
TASK_AGENT = "agent"
TASK_TYPE_CHOICES = [
    (TASK_CHAT, "Chat"),
    (TASK_SUMMARY, "Summary"),
    (TASK_SENTIMENT, "Sentiment"),
    (TASK_LEAD_SCORE, "Lead Score"),
    (TASK_DEAL_PREDICT, "Deal Predict"),
    (TASK_EMAIL_DRAFT, "Email Draft"),
    (TASK_AGENT, "Agent"),
]

# Per-model USD cost per 1K tokens (input, output) — used by the stub
# cost calculator in services. Real provider pricing would live in env /
# a pricing table.
MODEL_PRICING_USD_PER_1K = {
    "gpt-4o-mini": (Decimal("0.00015"), Decimal("0.0006")),
    "gpt-4o": (Decimal("0.0025"), Decimal("0.01")),
    "claude-3-5-sonnet": (Decimal("0.003"), Decimal("0.015")),
    "gemini-1.5-pro": (Decimal("0.00125"), Decimal("0.005")),
}

# Monthly USD budget per tenant (free plan = $50; production would look
# this up from Organization.plan).
DEFAULT_MONTHLY_BUDGET_USD = Decimal("50.00")


###############################################################################
# AICostLog
###############################################################################


class AICostLog(TenantModel):
    """Append-only ledger row for one LLM call.

    Written by :func:`ai_core.services.call_llm` after every invocation.
    Aggregated by :func:`ai_core.services.check_budget` to compute the
    tenant's month-to-date spend.
    """

    model = models.CharField(max_length=64, db_index=True)
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    cost = models.DecimalField(max_digits=12, decimal_places=6, default=0)
    task_type = models.CharField(
        max_length=32, choices=TASK_TYPE_CHOICES, default=TASK_CHAT, db_index=True
    )
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        db_table = "ai_core_costlog"
        verbose_name = "AI cost log"
        verbose_name_plural = "AI cost logs"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "-created_at"], name="ai_cost_created_idx"),
            models.Index(
                fields=["tenant", "task_type", "-created_at"], name="ai_cost_task_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.model} / {self.task_type} / ${self.cost} @ {self.created_at:%Y-%m-%d}"


###############################################################################
# PromptTemplate
###############################################################################


class PromptTemplate(TenantModel):
    """A versioned prompt pair (system + user-template).

    Exactly one row per ``(tenant, name)`` should be ``is_active=True``;
    :func:`ai_core.services.activate_template` enforces this atomically.
    The ``user_prompt_template`` field is a Python ``str.format`` template
    whose placeholder kwargs are supplied by the caller.
    """

    name = models.CharField(max_length=128, db_index=True)
    version = models.PositiveIntegerField(default=1)
    system_prompt = models.TextField(default="")
    user_prompt_template = models.TextField(default="")
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        db_table = "ai_core_prompttemplate"
        verbose_name = "prompt template"
        verbose_name_plural = "prompt templates"
        ordering = ["name", "-version"]
        unique_together = (("tenant", "name", "version"),)
        indexes = [
            models.Index(
                fields=["tenant", "is_active", "name"], name="ai_prompt_active_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} v{self.version} ({'active' if self.is_active else 'inactive'})"


__all__ = [
    "AICostLog",
    "DEFAULT_MONTHLY_BUDGET_USD",
    "MODEL_PRICING_USD_PER_1K",
    "PromptTemplate",
    "TASK_AGENT",
    "TASK_CHAT",
    "TASK_DEAL_PREDICT",
    "TASK_EMAIL_DRAFT",
    "TASK_LEAD_SCORE",
    "TASK_SENTIMENT",
    "TASK_SUMMARY",
    "TASK_TYPE_CHOICES",
]
