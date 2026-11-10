"""Assignment-rule models — auto-assign records to users based on criteria.

A :class:`AssignmentRule` is a tenant-scoped, per-target-model rule with:

* ``criteria`` — a JSON dict of ``{field: value}`` that the record must
  match (exact-match semantics). An empty dict matches every record.
* ``strategy`` — one of ``round_robin`` / ``lead_balance`` / ``territory``
  / ``custom``.
* ``assign_to`` — a JSON list whose shape depends on ``strategy``:

  * ``round_robin`` — list of user ids; the service tracks the last
    assignment via :class:`AssignmentHistory` and picks the next user in
    the list.
  * ``lead_balance`` — list of user ids; the service picks the user with
    the fewest open records.
  * ``territory`` — single ``{field: "value", user_map: {"US": 1, "EU":
    2}}`` object; the service looks up ``record[territory_field]`` in
    ``user_map``.
  * ``custom`` — single ``{"expression": "..."}`` object; the service
    evaluates the expression with the record's fields as locals and
    expects a user id back.

* ``fallback_user`` — nullable FK to :class:`User`. Used when no strategy
  resolves a user (e.g. territory lookup misses).

:class:`AssignmentHistory` is the append-only audit trail of every
assignment the engine makes.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import TenantModel, User


###############################################################################
# Constants
###############################################################################


#: Strategy choices for :class:`AssignmentRule.strategy`.
STRATEGY_ROUND_ROBIN = "round_robin"
STRATEGY_LEAD_BALANCE = "lead_balance"
STRATEGY_TERRITORY = "territory"
STRATEGY_CUSTOM = "custom"
STRATEGY_CHOICES = [
    (STRATEGY_ROUND_ROBIN, "Round robin"),
    (STRATEGY_LEAD_BALANCE, "Lead balance"),
    (STRATEGY_TERRITORY, "Territory"),
    (STRATEGY_CUSTOM, "Custom"),
]


###############################################################################
# AssignmentRule
###############################################################################


class AssignmentRule(TenantModel):
    """A tenant-scoped assignment rule.

    See the module docstring for the ``strategy`` + ``assign_to`` shape
    contract. ``order`` (not exposed — the service uses ``id`` ascending)
    is implicit: the first matching rule wins.
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
    strategy = models.CharField(
        max_length=32,
        choices=STRATEGY_CHOICES,
        default=STRATEGY_ROUND_ROBIN,
        db_index=True,
    )
    assign_to = models.JSONField(
        default=list,
        blank=True,
        help_text=(
            "Strategy-dependent: list of user ids for round_robin / "
            "lead_balance; {field, user_map} for territory; "
            "{expression} for custom."
        ),
    )
    fallback_user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="fallback_assignments",
    )
    territory_field = models.CharField(
        max_length=128,
        blank=True,
        default="",
        help_text="Required when strategy=territory. The record field to look up in assign_to.user_map.",
    )
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        db_table = "assignment_rules_assignmentrule"
        verbose_name = "assignment rule"
        verbose_name_plural = "assignment rules"
        indexes = [
            models.Index(
                fields=["tenant", "target_model", "is_active"],
                name="assign_rule_target_active_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.target_model} → {self.strategy} (active={self.is_active})"


###############################################################################
# AssignmentHistory
###############################################################################


class AssignmentHistory(TenantModel):
    """Append-only audit trail of every assignment the engine makes.

    Rows are created by :meth:`assignment_rules.services.AssignmentService.assign`
    on every successful assignment. The ``rule`` FK is SET_NULL so
    deleting a rule doesn't cascade onto the history.
    """

    rule = models.ForeignKey(
        AssignmentRule,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assignments",
        db_index=True,
    )
    record_module = models.CharField(max_length=32, db_index=True)
    record_id = models.CharField(max_length=64, db_index=True)
    assigned_to = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assignment_history",
    )
    assigned_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        db_table = "assignment_rules_assignmenthistory"
        verbose_name = "assignment history"
        verbose_name_plural = "assignment histories"
        ordering = ["-assigned_at"]
        indexes = [
            models.Index(
                fields=["tenant", "record_module", "record_id"],
                name="assign_hist_record_idx",
            ),
        ]

    def __str__(self) -> str:
        return (
            f"{self.record_module}:{self.record_id} → "
            f"{self.assigned_to_id} @ {self.assigned_at:%Y-%m-%d %H:%M}"
        )


__all__ = [
    "AssignmentHistory",
    "AssignmentRule",
    "STRATEGY_CHOICES",
    "STRATEGY_CUSTOM",
    "STRATEGY_LEAD_BALANCE",
    "STRATEGY_ROUND_ROBIN",
    "STRATEGY_TERRITORY",
]
