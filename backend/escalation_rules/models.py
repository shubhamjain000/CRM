"""Escalation-rule models — auto-escalate records that breach an SLA.

A :class:`EscalationRule` is a tenant-scoped, per-target-model rule with:

* ``criteria`` — a JSON dict of ``{field: value}`` that the record must
  match (exact-match semantics). An empty dict matches every record.
* ``time_limit_hours`` — the SLA. Records whose ``created_at`` is older
  than ``now - time_limit_hours`` are escalated.
* ``escalate_to`` — a JSON ``{type, value}`` dict where ``type`` is one
  of ``user`` / ``role`` / ``team``. Mirrors the
  :class:`approvals.models.ApprovalStep.approvers` shape so the
  approval service's resolver can be reused.
* ``action`` — one of ``reassign`` / ``notify`` / ``both``.

:class:`EscalationLog` is the append-only audit trail of every escalation
the engine makes.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import TenantModel, User


###############################################################################
# Constants
###############################################################################


#: Action choices for :class:`EscalationRule.action`.
ACTION_REASSIGN = "reassign"
ACTION_NOTIFY = "notify"
ACTION_BOTH = "both"
ACTION_CHOICES = [
    (ACTION_REASSIGN, "Reassign"),
    (ACTION_NOTIFY, "Notify"),
    (ACTION_BOTH, "Both"),
]

#: Escalate-to-type choices for the ``escalate_to`` JSON.
ESCALATE_TYPE_USER = "user"
ESCALATE_TYPE_ROLE = "role"
ESCALATE_TYPE_TEAM = "team"
ESCALATE_TYPE_CHOICES = [
    (ESCALATE_TYPE_USER, "User"),
    (ESCALATE_TYPE_ROLE, "Role"),
    (ESCALATE_TYPE_TEAM, "Team"),
]


###############################################################################
# EscalationRule
###############################################################################


class EscalationRule(TenantModel):
    """A tenant-scoped escalation rule.

    The Celery beat task :func:`escalation_rules.tasks.run_escalation_check`
    walks every active rule every 15 minutes, finds records matching
    ``criteria`` whose ``created_at`` exceeds ``time_limit_hours``, and
    takes the configured ``action`` (``reassign`` / ``notify`` / ``both``)
    against each. Every escalation is logged in :class:`EscalationLog`.
    """

    target_model = models.CharField(
        max_length=32,
        db_index=True,
        help_text="Which CRM entity this rule applies to (deal / lead / contact / account).",
    )
    criteria = models.JSONField(
        default=dict,
        blank=True,
        help_text=(
            "JSON dict of {field: value} that the record must match "
            "(exact-match). Empty dict matches every record."
        ),
    )
    time_limit_hours = models.PositiveIntegerField(
        help_text="Records older than this many hours are escalated.",
    )
    escalate_to = models.JSONField(
        default=dict,
        blank=True,
        help_text=(
            "{type, value} dict. type ∈ {user, role, team}. value is "
            "the user id / role name / team id."
        ),
    )
    action = models.CharField(
        max_length=16,
        choices=ACTION_CHOICES,
        default=ACTION_NOTIFY,
        db_index=True,
    )
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        db_table = "escalation_rules_escalationrule"
        verbose_name = "escalation rule"
        verbose_name_plural = "escalation rules"
        indexes = [
            models.Index(
                fields=["tenant", "target_model", "is_active"],
                name="escrule_target_active_idx",
            ),
        ]

    def __str__(self) -> str:
        return (
            f"{self.target_model} escalate after {self.time_limit_hours}h "
            f"({self.action})"
        )


###############################################################################
# EscalationLog
###############################################################################


class EscalationLog(TenantModel):
    """Append-only audit trail of every escalation the engine makes.

    Rows are created by :meth:`escalation_rules.services.EscalationService.check_escalations`
    on every escalation. The ``rule`` FK is SET_NULL so deleting a rule
    doesn't cascade onto the log.
    """

    rule = models.ForeignKey(
        EscalationRule,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="logs",
        db_index=True,
    )
    record_module = models.CharField(max_length=32, db_index=True)
    record_id = models.CharField(max_length=64, db_index=True)
    escalated_to = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="escalation_logs",
    )
    action_taken = models.CharField(max_length=16, db_index=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        db_table = "escalation_rules_escalationlog"
        verbose_name = "escalation log"
        verbose_name_plural = "escalation logs"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "created_at"], name="esclog_tenant_created_idx"),
        ]

    def __str__(self) -> str:
        return (
            f"{self.record_module}:{self.record_id} → "
            f"{self.escalated_to_id} ({self.action_taken}) @ {self.created_at:%Y-%m-%d %H:%M}"
        )


__all__ = [
    "ACTION_BOTH",
    "ACTION_CHOICES",
    "ACTION_NOTIFY",
    "ACTION_REASSIGN",
    "ESCALATE_TYPE_CHOICES",
    "ESCALATE_TYPE_ROLE",
    "ESCALATE_TYPE_TEAM",
    "ESCALATE_TYPE_USER",
    "EscalationLog",
    "EscalationRule",
]
