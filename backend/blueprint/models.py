"""Blueprint engine models (Zoho Blueprint equivalent).

A :class:`Blueprint` binds to a :class:`deals.models_pipeline.Pipeline` and
augments it with a state-machine runtime:

* :class:`BlueprintState` — one row per pipeline :class:`Stage` with typed
  state metadata (``normal`` / ``transitional`` / ``terminal``), entry / exit
  action lists, an optional ``time_limit_hours`` (drives the stuck-deal
  alert), and an optional ``escalation_blueprint`` FK (a deal that exceeds
  the limit is escalated into another blueprint's flow).
* :class:`BlueprintTransition` — the directed edge between two
  :class:`BlueprintState` rows. Carries a role allow-list, a JSON condition
  blob, a list of required field names, an optional approval gate, and a
  post-transition action list.
* :class:`BlueprintFieldRequirement` — structured per-field condition on a
  transition (e.g. ``amount`` ``greater_than`` ``50000``). The simple
  ``require_fields`` list on the transition is the "must be filled" shortcut;
  this model is the richer rule layer.
* :class:`BlueprintAssignment` — per-transition assignment rule (role /
  user / team / field_value).
* :class:`BlueprintTimer` — per-state timer that auto-transitions, notifies,
  or escalates when a deal overstays the state.
* :class:`BlueprintExecution` — the runtime state-machine for a single
  :class:`Deal` (current state, ``entered_state_at`` timestamp, history log,
  completion flag).

All models inherit :class:`api.models.TenantModel` (tenant FK +
``created_at`` / ``updated_at``) and are scoped by
:class:`api.managers.TenantManager`.
"""

from __future__ import annotations

from django.db import models

from approvals.models import ApprovalProcess
from api.models import TenantModel, User
from deals.models import Deal
from deals.models_pipeline import Pipeline, Stage


###############################################################################
# Constants
###############################################################################

#: State-type choices for :class:`BlueprintState.state_type`.
STATE_TYPE_NORMAL = "normal"
STATE_TYPE_TRANSITIONAL = "transitional"
STATE_TYPE_TERMINAL = "terminal"
STATE_TYPE_CHOICES = [
    (STATE_TYPE_NORMAL, "Normal"),
    (STATE_TYPE_TRANSITIONAL, "Transitional"),
    (STATE_TYPE_TERMINAL, "Terminal"),
]

#: Condition choices for :class:`BlueprintFieldRequirement.condition`.
CONDITION_NOT_EMPTY = "not_empty"
CONDITION_EQUALS = "equals"
CONDITION_NOT_EQUALS = "not_equals"
CONDITION_GREATER_THAN = "greater_than"
CONDITION_LESS_THAN = "less_than"
CONDITION_IN = "in"
CONDITION_CHOICES = [
    (CONDITION_NOT_EMPTY, "Not empty"),
    (CONDITION_EQUALS, "Equals"),
    (CONDITION_NOT_EQUALS, "Not equals"),
    (CONDITION_GREATER_THAN, "Greater than"),
    (CONDITION_LESS_THAN, "Less than"),
    (CONDITION_IN, "In"),
]

#: Assign-to choices for :class:`BlueprintAssignment.assign_to`.
ASSIGN_TO_ROLE = "role"
ASSIGN_TO_USER = "user"
ASSIGN_TO_TEAM = "team"
ASSIGN_TO_FIELD_VALUE = "field_value"
ASSIGN_TO_CHOICES = [
    (ASSIGN_TO_ROLE, "Role"),
    (ASSIGN_TO_USER, "User"),
    (ASSIGN_TO_TEAM, "Team"),
    (ASSIGN_TO_FIELD_VALUE, "Field value"),
]

#: Timer action choices for :class:`BlueprintTimer.action`.
TIMER_ACTION_AUTO_TRANSITION = "auto_transition"
TIMER_ACTION_NOTIFY = "notify"
TIMER_ACTION_ESCALATE = "escalate"
TIMER_ACTION_CHOICES = [
    (TIMER_ACTION_AUTO_TRANSITION, "Auto transition"),
    (TIMER_ACTION_NOTIFY, "Notify"),
    (TIMER_ACTION_ESCALATE, "Escalate"),
]


###############################################################################
# Blueprint
###############################################################################


class Blueprint(TenantModel):
    """A published state-machine overlay on top of a :class:`Pipeline`.

    A pipeline has *at most one* active blueprint at a time — enforced by
    a partial unique index on ``(tenant, pipeline)`` filtered by
    ``is_active=True``. Drafts / archived versions keep ``is_active=False``
    so historical versions remain queryable.

    The ``version`` field is bumped by the ``publish`` action so callers
    can track which published iteration a deal entered against.
    """

    tenant = models.ForeignKey(
        "api.Organization",
        on_delete=models.CASCADE,
        related_name="blueprints",
        db_index=True,
    )
    name = models.CharField(max_length=128)
    pipeline = models.ForeignKey(
        Pipeline,
        on_delete=models.CASCADE,
        related_name="blueprints",
        db_index=True,
    )
    is_active = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Only one active blueprint may exist per pipeline at a time.",
    )
    is_published = models.BooleanField(
        default=False,
        help_text="Published blueprints are immutable; drafts can be edited.",
    )
    description = models.TextField(blank=True, default="")
    version = models.PositiveIntegerField(default=1)

    class Meta:
        db_table = "blueprint_blueprint"
        verbose_name = "blueprint"
        verbose_name_plural = "blueprints"
        indexes = [
            models.Index(fields=["tenant", "pipeline", "is_active"], name="bp_tenant_pipe_active_idx"),
        ]
        constraints = [
            # Partial unique — only one *active* blueprint per pipeline.
            models.UniqueConstraint(
                condition=models.Q(is_active=True),
                fields=["tenant", "pipeline"],
                name="blueprint_one_active_per_pipeline",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} (v{self.version})"


###############################################################################
# BlueprintState
###############################################################################


class BlueprintState(TenantModel):
    """A typed state in a :class:`Blueprint`, mapped 1:1 to a :class:`Stage`.

    ``entry_actions`` / ``exit_actions`` are JSON lists of action dicts —
    see :meth:`blueprint.services.BlueprintService.run_actions` for the
    supported action schema.

    ``time_limit_hours`` is the soft SLA for a deal in this state. When the
    limit is exceeded the deal is flagged by
    :meth:`blueprint.services.BlueprintService.get_stuck_deals`. The
    separate :class:`BlueprintTimer` rows define what *happens* when the
    limit (or any other duration) is exceeded.
    """

    tenant = models.ForeignKey(
        "api.Organization",
        on_delete=models.CASCADE,
        related_name="blueprint_states",
        db_index=True,
    )
    blueprint = models.ForeignKey(
        Blueprint,
        on_delete=models.CASCADE,
        related_name="states",
        db_index=True,
    )
    stage = models.ForeignKey(
        Stage,
        on_delete=models.CASCADE,
        related_name="blueprint_states",
        db_index=True,
    )
    state_type = models.CharField(
        max_length=16,
        choices=STATE_TYPE_CHOICES,
        default=STATE_TYPE_NORMAL,
        db_index=True,
    )
    entry_actions = models.JSONField(default=list, blank=True)
    exit_actions = models.JSONField(default=list, blank=True)
    time_limit_hours = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Soft SLA in hours. Drives the stuck-deal alert.",
    )
    escalation_blueprint = models.ForeignKey(
        Blueprint,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="escalating_states",
        help_text="When the time_limit is exceeded, the deal may be moved into this blueprint's flow.",
    )

    class Meta:
        db_table = "blueprint_state"
        verbose_name = "blueprint state"
        verbose_name_plural = "blueprint states"
        unique_together = (("blueprint", "stage"),)
        indexes = [
            models.Index(fields=["blueprint"], name="bp_state_blueprint_idx"),
            models.Index(fields=["blueprint", "state_type"], name="bp_state_type_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.blueprint.name} → {self.stage.name}"


###############################################################################
# BlueprintTransition
###############################################################################


class BlueprintTransition(TenantModel):
    """A directed edge ``from_state → to_state`` inside a :class:`Blueprint`.

    Rules enforced by :class:`blueprint.services.BlueprintService`:

    * ``allowed_roles`` (list of role names) gates the transition by the
      actor's role. An empty list means **all roles** may transition.
    * ``conditions`` is a JSON rule set evaluated against the deal (see
      :meth:`blueprint.services.BlueprintService.evaluate_condition`).
      Example: ``{"amount": {"$gt": 50000}}``.
    * ``require_fields`` is a simple list of field names that must be
      non-empty on the deal. Use :class:`BlueprintFieldRequirement` for
      per-field structured conditions (equals / greater_than / in / ...).
    * ``require_approval`` (nullable FK to :class:`ApprovalProcess`) — when
      set, ``execute_transition`` flags the result ``requires_approval=True``
      and creates a notification to the approvers (Phase-9 stub; the actual
      approval workflow ships in Phase 9).
    * ``post_transition_actions`` is a JSON list of action dicts executed
      after the deal is moved (see
      :meth:`blueprint.services.BlueprintService.run_actions`).
    """

    tenant = models.ForeignKey(
        "api.Organization",
        on_delete=models.CASCADE,
        related_name="blueprint_transitions",
        db_index=True,
    )
    blueprint = models.ForeignKey(
        Blueprint,
        on_delete=models.CASCADE,
        related_name="transitions",
        db_index=True,
    )
    from_state = models.ForeignKey(
        BlueprintState,
        on_delete=models.CASCADE,
        related_name="outgoing_transitions",
        db_index=True,
    )
    to_state = models.ForeignKey(
        BlueprintState,
        on_delete=models.CASCADE,
        related_name="incoming_transitions",
        db_index=True,
    )
    allowed_roles = models.JSONField(
        default=list,
        blank=True,
        help_text="List of role names permitted to take this transition. Empty = all roles.",
    )
    conditions = models.JSONField(
        default=dict,
        blank=True,
        help_text='Field-expression rule set, e.g. {"amount": {"$gt": 50000}}.',
    )
    require_fields = models.JSONField(
        default=list,
        blank=True,
        help_text="List of deal field names that must be non-empty for this transition.",
    )
    require_approval = models.ForeignKey(
        ApprovalProcess,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="blueprint_transitions",
        help_text="Optional approval gate (Phase 10 enforces the workflow via the approvals app).",
    )
    post_transition_actions = models.JSONField(
        default=list,
        blank=True,
        help_text="Action list executed after the deal moves into ``to_state``.",
    )

    class Meta:
        db_table = "blueprint_transition"
        verbose_name = "blueprint transition"
        verbose_name_plural = "blueprint transitions"
        unique_together = (("blueprint", "from_state", "to_state"),)
        indexes = [
            models.Index(fields=["blueprint", "from_state"], name="bp_trans_from_idx"),
            models.Index(fields=["blueprint", "to_state"], name="bp_trans_to_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.from_state.stage.name} → {self.to_state.stage.name}"


###############################################################################
# BlueprintFieldRequirement
###############################################################################


class BlueprintFieldRequirement(TenantModel):
    """Structured per-field requirement on a :class:`BlueprintTransition`.

    While :attr:`BlueprintTransition.require_fields` is a flat list of
    "must be non-empty" field names, this model lets a transition say
    things like ``amount`` must be ``greater_than`` ``50000`` or
    ``lead_source`` must be ``in`` ``["web", "referral"]``.
    """

    tenant = models.ForeignKey(
        "api.Organization",
        on_delete=models.CASCADE,
        related_name="blueprint_field_requirements",
        db_index=True,
    )
    transition = models.ForeignKey(
        BlueprintTransition,
        on_delete=models.CASCADE,
        related_name="field_requirements",
        db_index=True,
    )
    field_name = models.CharField(max_length=128)
    condition = models.CharField(
        max_length=32,
        choices=CONDITION_CHOICES,
        default=CONDITION_NOT_EMPTY,
    )
    value = models.TextField(
        blank=True,
        default="",
        help_text="Comparison value (parsed by the service based on the field type).",
    )

    class Meta:
        db_table = "blueprint_field_requirement"
        verbose_name = "blueprint field requirement"
        verbose_name_plural = "blueprint field requirements"
        indexes = [
            models.Index(fields=["transition"], name="bp_fieldreq_trans_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.field_name} {self.condition} {self.value}"


###############################################################################
# BlueprintAssignment
###############################################################################


class BlueprintAssignment(TenantModel):
    """Per-transition assignment rule.

    On a successful transition, each assignment row is resolved into a
    concrete user / team and used by the ``assign_to`` action. The four
    ``assign_to`` modes:

    * ``role`` — ``assign_value`` is a role name; assign to the first user
      in the tenant with that role.
    * ``user`` — ``assign_value`` is a user id.
    * ``team`` — ``assign_value`` is a team id.
    * ``field_value`` — ``assign_value`` is a deal field name; the deal's
      value for that field is the assignee.
    """

    tenant = models.ForeignKey(
        "api.Organization",
        on_delete=models.CASCADE,
        related_name="blueprint_assignments",
        db_index=True,
    )
    transition = models.ForeignKey(
        BlueprintTransition,
        on_delete=models.CASCADE,
        related_name="assignments",
        db_index=True,
    )
    assign_to = models.CharField(
        max_length=16,
        choices=ASSIGN_TO_CHOICES,
        default=ASSIGN_TO_ROLE,
    )
    assign_value = models.CharField(
        max_length=128,
        help_text="Role name, user id, team id, or field name (depending on ``assign_to``).",
    )

    class Meta:
        db_table = "blueprint_assignment"
        verbose_name = "blueprint assignment"
        verbose_name_plural = "blueprint assignments"
        indexes = [
            models.Index(fields=["transition"], name="bp_assign_trans_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.assign_to}={self.assign_value}"


###############################################################################
# BlueprintTimer
###############################################################################


class BlueprintTimer(TenantModel):
    """A per-state timer that fires when a deal overstays the state.

    The Celery beat task ``blueprint.run_blueprint_timers`` (hourly) walks
    every active :class:`BlueprintExecution` and, for each timer on the
    current state whose ``hours`` have elapsed since ``entered_state_at``,
    takes the configured ``action``:

    * ``auto_transition`` — move the deal to ``target_state``.
    * ``notify`` — send a notification to every user in ``notify_roles``.
    * ``escalate`` — send a notification to ``escalate_to`` (a role name
      or a user id).
    """

    tenant = models.ForeignKey(
        "api.Organization",
        on_delete=models.CASCADE,
        related_name="blueprint_timers",
        db_index=True,
    )
    state = models.ForeignKey(
        BlueprintState,
        on_delete=models.CASCADE,
        related_name="timers",
        db_index=True,
    )
    hours = models.PositiveIntegerField(help_text="Fire after this many hours in the state.")
    action = models.CharField(
        max_length=32,
        choices=TIMER_ACTION_CHOICES,
        default=TIMER_ACTION_NOTIFY,
    )
    target_state = models.ForeignKey(
        BlueprintState,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="timer_auto_transitions",
        help_text="Required when action=auto_transition.",
    )
    notify_roles = models.JSONField(
        default=list,
        blank=True,
        help_text="List of role names to notify when action=notify.",
    )
    escalate_to = models.CharField(
        max_length=128,
        blank=True,
        default="",
        help_text="Role name or user id to notify when action=escalate.",
    )

    class Meta:
        db_table = "blueprint_timer"
        verbose_name = "blueprint timer"
        verbose_name_plural = "blueprint timers"
        indexes = [
            models.Index(fields=["state"], name="bp_timer_state_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.state}: {self.action} after {self.hours}h"


###############################################################################
# BlueprintExecution
###############################################################################


class BlueprintExecution(TenantModel):
    """The runtime state machine for a single :class:`Deal`.

    Exactly one execution per deal — enforced by ``unique_together`` on
    ``(deal,)``. The execution records:

    * ``current_state`` — nullable (SET_NULL) so deleting a state doesn't
      cascade onto executions; the deal stays put but the runtime is
      effectively paused until the blueprint is republished.
    * ``entered_state_at`` — when the deal entered ``current_state``. Used
      by :class:`BlueprintTimer` + the stuck-deal alert.
    * ``history`` — append-only JSON list of ``{from_state, to_state,
      changed_by, changed_at, reason}`` entries. The canonical audit
      trail is the :class:`deals.models.DealStageHistory` row written by
      :meth:`blueprint.services.BlueprintService.execute_transition`; this
      list is the cheap in-place mirror for the UI.
    * ``is_complete`` — flipped to ``True`` when the deal reaches a
      terminal state.
    """

    tenant = models.ForeignKey(
        "api.Organization",
        on_delete=models.CASCADE,
        related_name="blueprint_executions",
        db_index=True,
    )
    deal = models.ForeignKey(
        Deal,
        on_delete=models.CASCADE,
        related_name="blueprint_executions",
        db_index=True,
    )
    blueprint = models.ForeignKey(
        Blueprint,
        on_delete=models.CASCADE,
        related_name="executions",
        db_index=True,
    )
    current_state = models.ForeignKey(
        BlueprintState,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="active_executions",
    )
    entered_state_at = models.DateTimeField()
    history = models.JSONField(
        default=list,
        blank=True,
        help_text="Append-only list of {from_state, to_state, changed_by, changed_at, reason} entries.",
    )
    is_complete = models.BooleanField(default=False, db_index=True)

    class Meta:
        db_table = "blueprint_execution"
        verbose_name = "blueprint execution"
        verbose_name_plural = "blueprint executions"
        unique_together = (("deal",),)
        indexes = [
            models.Index(fields=["tenant", "current_state"], name="bp_exec_current_idx"),
            models.Index(fields=["tenant", "is_complete"], name="bp_exec_complete_idx"),
        ]

    def __str__(self) -> str:
        return f"Execution(deal={self.deal_id}, state={self.current_state_id})"

    def append_history(
        self,
        *,
        from_state: int | None,
        to_state: int | None,
        changed_by: User,
        changed_at,
        reason: str = "",
    ) -> None:
        """Append an entry to the in-place ``history`` list (does NOT save)."""
        self.history.append(
            {
                "from_state": from_state,
                "to_state": to_state,
                "changed_by": changed_by.pk,
                "changed_at": changed_at.isoformat(),
                "reason": reason or "",
            }
        )


__all__ = [
    "ASSIGN_TO_CHOICES",
    "ASSIGN_TO_FIELD_VALUE",
    "ASSIGN_TO_ROLE",
    "ASSIGN_TO_TEAM",
    "ASSIGN_TO_USER",
    "CONDITION_CHOICES",
    "CONDITION_EQUALS",
    "CONDITION_GREATER_THAN",
    "CONDITION_IN",
    "CONDITION_LESS_THAN",
    "CONDITION_NOT_EMPTY",
    "CONDITION_NOT_EQUALS",
    "STATE_TYPE_CHOICES",
    "STATE_TYPE_NORMAL",
    "STATE_TYPE_TERMINAL",
    "STATE_TYPE_TRANSITIONAL",
    "TIMER_ACTION_AUTO_TRANSITION",
    "TIMER_ACTION_CHOICES",
    "TIMER_ACTION_ESCALATE",
    "TIMER_ACTION_NOTIFY",
    "Blueprint",
    "BlueprintAssignment",
    "BlueprintExecution",
    "BlueprintFieldRequirement",
    "BlueprintState",
    "BlueprintTimer",
    "BlueprintTransition",
]
