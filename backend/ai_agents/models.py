"""Database models for the ai_agents app (Phase 18).

One tenant-scoped model:

* :class:`AIAgentRun` — a single agent execution. ``agent_type`` ∈
  {lead_research, deal_coach, email_triage, data_hygiene,
  customer_success}; ``target_module`` + ``target_id`` are the
  polymorphic target that triggered the run. ``status`` ∈ {running,
  completed, failed}; ``result`` is the JSON output (e.g. suggested
  talking points, drafted email, hygiene fixes applied).
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import TenantModel

AGENT_LEAD_RESEARCH = "lead_research"
AGENT_DEAL_COACH = "deal_coach"
AGENT_EMAIL_TRIAGE = "email_triage"
AGENT_DATA_HYGIENE = "data_hygiene"
AGENT_CUSTOMER_SUCCESS = "customer_success"
AGENT_TYPE_CHOICES = [
    (AGENT_LEAD_RESEARCH, "Lead Research"),
    (AGENT_DEAL_COACH, "Deal Coach"),
    (AGENT_EMAIL_TRIAGE, "Email Triage"),
    (AGENT_DATA_HYGIENE, "Data Hygiene"),
    (AGENT_CUSTOMER_SUCCESS, "Customer Success"),
]

STATUS_RUNNING = "running"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
STATUS_CHOICES = [
    (STATUS_RUNNING, "Running"),
    (STATUS_COMPLETED, "Completed"),
    (STATUS_FAILED, "Failed"),
]


class AIAgentRun(TenantModel):
    """A single AI agent execution row."""

    agent_type = models.CharField(
        max_length=32, choices=AGENT_TYPE_CHOICES, db_index=True
    )
    target_module = models.CharField(max_length=32, default="")
    target_id = models.CharField(max_length=32, default="")
    status = models.CharField(
        max_length=16, choices=STATUS_CHOICES, default=STATUS_RUNNING, db_index=True
    )
    result = models.JSONField(default=dict, blank=True)
    started_at = models.DateTimeField(default=timezone.now, db_index=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "ai_agents_run"
        verbose_name = "AI agent run"
        verbose_name_plural = "AI agent runs"
        ordering = ["-started_at"]
        indexes = [
            models.Index(
                fields=["tenant", "agent_type", "-started_at"],
                name="agent_type_started_idx",
            ),
            models.Index(fields=["tenant", "status"], name="agent_status_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.agent_type} / {self.target_module}:{self.target_id} [{self.status}]"


__all__ = [
    "AGENT_CUSTOMER_SUCCESS",
    "AGENT_DATA_HYGIENE",
    "AGENT_DEAL_COACH",
    "AGENT_EMAIL_TRIAGE",
    "AGENT_LEAD_RESEARCH",
    "AGENT_TYPE_CHOICES",
    "AIAgentRun",
    "STATUS_CHOICES",
    "STATUS_COMPLETED",
    "STATUS_FAILED",
    "STATUS_RUNNING",
]
