"""Approvals models — multi-step approval workflow engine.

This app is the canonical home for :class:`ApprovalProcess` (previously a
stub in :mod:`deals.models`). The full schema adds:

* :class:`ApprovalProcess` — a tenant-scoped, versioned approval definition
  with a ``target_model`` (deal / lead / contact / account / task / event)
  and a JSON ``trigger_criteria`` blob that determines *when* this approval
  is needed (e.g. ``{"amount": {"$gt": 50000}, "stage": "negotiation"}``).
  The ``version`` field is bumped on every publish so historical
  :class:`ApprovalRequest` rows stay pinned to the rule set they were
  evaluated against.
* :class:`ApprovalStep` — an ordered step in the process. ``step_type``
  drives the resolution strategy (``sequential`` / ``parallel`` /
  ``first_to_approve`` / ``majority_vote`` / ``unanimous``). ``approvers``
  is a JSON list of ``{type, value}`` dicts where ``type`` is one of
  ``role`` / ``user`` / ``team`` / ``dynamic``. ``time_limit_hours`` +
  ``escalation_approver`` feed the hourly
  :meth:`approvals.services.ApprovalService.escalate_expired` sweep.
* :class:`ApprovalRequest` — a runtime instance of an approval,
  polymorphically pointed at any CRM record via ``target_module`` +
  ``target_id`` + ``target_name``. ``current_step`` tracks the active
  :class:`ApprovalStep`; ``status`` is one of ``pending`` / ``approved``
  / ``rejected`` / ``recalled`` / ``escalated``.
* :class:`ApprovalAction` — append-only audit row written on every
  ``approve`` / ``reject`` / ``delegate`` / ``escalate`` action.
* :class:`ApprovalDelegation` — a date-ranged "out of office" rule that
  re-routes approvals from ``user`` → ``delegate_to``.

All models inherit :class:`api.models.TenantModel` (tenant FK +
``created_at`` / ``updated_at``) and are scoped by
:class:`api.managers.TenantManager`.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import TenantModel, User


###############################################################################
# Constants
###############################################################################


#: Target-model choices for :class:`ApprovalProcess.target_model`.
TARGET_MODEL_DEAL = "deal"
TARGET_MODEL_LEAD = "lead"
TARGET_MODEL_CONTACT = "contact"
TARGET_MODEL_ACCOUNT = "account"
TARGET_MODEL_TASK = "task"
TARGET_MODEL_EVENT = "event"
TARGET_MODEL_CHOICES = [
    (TARGET_MODEL_DEAL, "Deal"),
    (TARGET_MODEL_LEAD, "Lead"),
    (TARGET_MODEL_CONTACT, "Contact"),
    (TARGET_MODEL_ACCOUNT, "Account"),
    (TARGET_MODEL_TASK, "Task"),
    (TARGET_MODEL_EVENT, "Event"),
]

#: Step-type choices for :class:`ApprovalStep.step_type`.
STEP_SEQUENTIAL = "sequential"
STEP_PARALLEL = "parallel"
STEP_FIRST_TO_APPROVE = "first_to_approve"
STEP_MAJORITY_VOTE = "majority_vote"
STEP_UNANIMOUS = "unanimous"
STEP_TYPE_CHOICES = [
    (STEP_SEQUENTIAL, "Sequential"),
    (STEP_PARALLEL, "Parallel"),
    (STEP_FIRST_TO_APPROVE, "First to approve"),
    (STEP_MAJORITY_VOTE, "Majority vote"),
    (STEP_UNANIMOUS, "Unanimous"),
]

#: Approver-type choices for the ``approvers`` / ``escalation_approver`` JSON.
APPROVER_TYPE_ROLE = "role"
APPROVER_TYPE_USER = "user"
APPROVER_TYPE_TEAM = "team"
APPROVER_TYPE_DYNAMIC = "dynamic"
APPROVER_TYPE_CHOICES = [
    (APPROVER_TYPE_ROLE, "Role"),
    (APPROVER_TYPE_USER, "User"),
    (APPROVER_TYPE_TEAM, "Team"),
    (APPROVER_TYPE_DYNAMIC, "Dynamic"),
]

#: Status choices for :class:`ApprovalRequest.status`.
STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"
STATUS_RECALLED = "recalled"
STATUS_ESCALATED = "escalated"
STATUS_CHOICES = [
    (STATUS_PENDING, "Pending"),
    (STATUS_APPROVED, "Approved"),
    (STATUS_REJECTED, "Rejected"),
    (STATUS_RECALLED, "Recalled"),
    (STATUS_ESCALATED, "Escalated"),
]

#: Action choices for :class:`ApprovalAction.action`.
ACTION_APPROVE = "approve"
ACTION_REJECT = "reject"
ACTION_DELEGATE = "delegate"
ACTION_ESCALATE = "escalate"
ACTION_CHOICES = [
    (ACTION_APPROVE, "Approve"),
    (ACTION_REJECT, "Reject"),
    (ACTION_DELEGATE, "Delegate"),
    (ACTION_ESCALATE, "Escalate"),
]


###############################################################################
# ApprovalProcess
###############################################################################


class ApprovalProcess(TenantModel):
    """A tenant-scoped, versioned approval definition.

    The Phase-8 deals app shipped a stub with just ``name`` / ``description``
    / ``is_active``. Phase 10 promotes the model to the ``approvals`` app and
    extends the schema with:

    * ``target_model`` — which CRM entity the process applies to.
    * ``trigger_criteria`` — a JSON rule set (same operator vocabulary as
      :class:`blueprint.models.BlueprintTransition.conditions`) that
      determines *when* this approval is needed. Example:
      ``{"amount": {"$gt": 50000}, "stage": "negotiation"}``.
    * ``version`` — bumped on every publish so historical
      :class:`ApprovalRequest` rows stay pinned to the rule set they were
      evaluated against.

    The Phase-8 / Phase-9 ``StageTransition.require_approval`` and
    ``BlueprintTransition.require_approval`` FKs now point at this table.
    """

    name = models.CharField(max_length=128)
    description = models.TextField(blank=True, default="")
    target_model = models.CharField(
        max_length=32,
        choices=TARGET_MODEL_CHOICES,
        default=TARGET_MODEL_DEAL,
        db_index=True,
        help_text="Which CRM entity this approval process applies to.",
    )
    trigger_criteria = models.JSONField(
        default=dict,
        blank=True,
        help_text=(
            "JSON rule set (same operator vocabulary as "
            "BlueprintTransition.conditions) that determines when this "
            'approval is needed, e.g. {"amount": {"$gt": 50000}, '
            '"stage": "negotiation"}.'
        ),
    )
    is_active = models.BooleanField(default=True, db_index=True)
    version = models.PositiveIntegerField(default=1)

    class Meta:
        db_table = "approvals_approvalprocess"
        verbose_name = "approval process"
        verbose_name_plural = "approval processes"
        unique_together = (("tenant", "name"),)
        indexes = [
            models.Index(
                fields=["tenant", "target_model", "is_active"],
                name="approval_proc_target_active_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} (v{self.version})"


###############################################################################
# ApprovalStep
###############################################################################


class ApprovalStep(TenantModel):
    """An ordered step in an :class:`ApprovalProcess`.

    ``step_type`` drives how :class:`ApprovalService` resolves a step:

    * ``sequential`` — approvers act one at a time; the first action advances
      the request to the next step.
    * ``parallel`` — every approver in ``approvers`` must approve before the
      step completes.
    * ``first_to_approve`` — the first action (approve or reject) completes
      the step.
    * ``majority_vote`` — step completes when more than half of the
      approvers have approved.
    * ``unanimous`` — every approver must approve (any reject fails the
      step).

    ``approvers`` is a JSON list of ``{type, value}`` dicts where ``type``
    is one of ``role`` / ``user`` / ``team`` / ``dynamic``. ``time_limit_hours``
    + ``escalation_approver`` feed the hourly
    :meth:`approvals.services.ApprovalService.escalate_expired` sweep.
    """

    process = models.ForeignKey(
        ApprovalProcess,
        on_delete=models.CASCADE,
        related_name="steps",
        db_index=True,
    )
    order = models.PositiveIntegerField(
        default=0,
        db_index=True,
        help_text="Step order within the process (0-based, ascending).",
    )
    step_type = models.CharField(
        max_length=32,
        choices=STEP_TYPE_CHOICES,
        default=STEP_SEQUENTIAL,
    )
    approvers = models.JSONField(
        default=list,
        blank=True,
        help_text=(
            "JSON list of {type, value} dicts. type ∈ {role, user, team, "
            "dynamic}. value is the role name / user id / team id / dynamic "
            "expression."
        ),
    )
    time_limit_hours = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Soft SLA in hours. When exceeded, the step is escalated.",
    )
    escalation_approver = models.JSONField(
        default=dict,
        blank=True,
        help_text=(
            "Optional {type, value} approver to escalate to when the "
            "time_limit_hours is exceeded."
        ),
    )
    require_comment = models.BooleanField(
        default=False,
        help_text="If True, the actor must supply a comment on approve / reject.",
    )

    class Meta:
        db_table = "approvals_approvalstep"
        verbose_name = "approval step"
        verbose_name_plural = "approval steps"
        ordering = ["process", "order", "id"]
        unique_together = (("process", "order"),)
        indexes = [
            models.Index(fields=["process", "order"], name="approval_step_order_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.process.name} step #{self.order} ({self.step_type})"


###############################################################################
# ApprovalRequest
###############################################################################


class ApprovalRequest(TenantModel):
    """A runtime instance of an :class:`ApprovalProcess`.

    Polymorphically pointed at any CRM record via ``target_module`` +
    ``target_id`` + ``target_name``. ``current_step`` tracks the active
    :class:`ApprovalStep`; ``status`` is one of ``pending`` / ``approved``
    / ``rejected`` / ``recalled`` / ``escalated``.

    ``comments`` is an append-only JSON list of ``{user_id, comment,
    timestamp}`` entries — the canonical audit trail is the
    :class:`ApprovalAction` rows, but ``comments`` is the cheap in-place
    mirror for the UI.
    """

    process = models.ForeignKey(
        ApprovalProcess,
        on_delete=models.CASCADE,
        related_name="requests",
        db_index=True,
    )
    target_module = models.CharField(max_length=32, db_index=True)
    target_id = models.CharField(max_length=64, db_index=True)
    target_name = models.CharField(max_length=255, blank=True, default="")
    submitted_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="submitted_approval_requests",
    )
    submitted_at = models.DateTimeField(default=timezone.now, db_index=True)
    current_step = models.ForeignKey(
        ApprovalStep,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="active_requests",
    )
    status = models.CharField(
        max_length=16,
        choices=STATUS_CHOICES,
        default=STATUS_PENDING,
        db_index=True,
    )
    completed_at = models.DateTimeField(null=True, blank=True, db_index=True)
    comments = models.JSONField(
        default=list,
        blank=True,
        help_text="Append-only list of {user_id, comment, timestamp} entries.",
    )

    class Meta:
        db_table = "approvals_approvalrequest"
        verbose_name = "approval request"
        verbose_name_plural = "approval requests"
        ordering = ["-submitted_at"]
        indexes = [
            models.Index(fields=["tenant", "status"], name="approval_req_status_idx"),
            models.Index(
                fields=["tenant", "submitted_by"],
                name="approval_req_submitter_idx",
            ),
            models.Index(
                fields=["tenant", "target_module", "target_id"],
                name="approval_req_target_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.process.name} → {self.target_module}:{self.target_id} ({self.status})"

    @property
    def is_open(self) -> bool:
        """Return ``True`` when the request is still pending action."""
        return self.status == STATUS_PENDING

    def append_comment(self, *, user_id: int, comment: str) -> None:
        """Append a ``{user_id, comment, timestamp}`` entry to ``comments``.

        Does NOT call ``save()`` — the caller is expected to persist the row.
        """
        self.comments.append(
            {
                "user_id": user_id,
                "comment": comment or "",
                "timestamp": timezone.now().isoformat(),
            }
        )


###############################################################################
# ApprovalAction
###############################################################################


class ApprovalAction(TenantModel):
    """Append-only audit row written on every approve / reject / delegate / escalate.

    A row is created by :class:`ApprovalService` on every action. The
    :class:`ApprovalRequest` status + ``current_step`` are derived from the
    most recent action.
    """

    request = models.ForeignKey(
        ApprovalRequest,
        on_delete=models.CASCADE,
        related_name="actions",
        db_index=True,
    )
    approver = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="approval_actions",
    )
    action = models.CharField(max_length=16, choices=ACTION_CHOICES, db_index=True)
    comment = models.TextField(blank=True, default="")
    timestamp = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        db_table = "approvals_approvalaction"
        verbose_name = "approval action"
        verbose_name_plural = "approval actions"
        ordering = ["-timestamp"]
        indexes = [
            models.Index(fields=["request", "timestamp"], name="approval_action_ts_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.approver_id} {self.action} request={self.request_id} @ {self.timestamp:%Y-%m-%d %H:%M}"


###############################################################################
# ApprovalDelegation
###############################################################################


class ApprovalDelegation(TenantModel):
    """A date-ranged "out of office" rule that re-routes approvals.

    ``user`` is the delegating user, ``delegate_to`` is the stand-in. While
    ``is_active=True`` and today's date falls inside ``[start_date,
    end_date]``, :class:`ApprovalService` resolves ``user``'s pending
    approvals to ``delegate_to`` instead.
    """

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="approval_delegations_given",
    )
    delegate_to = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="approval_delegations_received",
    )
    start_date = models.DateField()
    end_date = models.DateField()
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        db_table = "approvals_approvaldelegation"
        verbose_name = "approval delegation"
        verbose_name_plural = "approval delegations"
        indexes = [
            models.Index(
                fields=["tenant", "user", "is_active"],
                name="approval_deleg_user_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} → {self.delegate_to_id} ({self.start_date} to {self.end_date})"

    def covers(self, today) -> bool:  # type: ignore[no-untyped-def]
        """Return ``True`` when ``today`` falls inside ``[start_date, end_date]``."""
        return bool(self.is_active and self.start_date <= today <= self.end_date)


__all__ = [
    "ACTION_APPROVE",
    "ACTION_CHOICES",
    "ACTION_DELEGATE",
    "ACTION_ESCALATE",
    "ACTION_REJECT",
    "APPROVER_TYPE_CHOICES",
    "APPROVER_TYPE_DYNAMIC",
    "APPROVER_TYPE_ROLE",
    "APPROVER_TYPE_TEAM",
    "APPROVER_TYPE_USER",
    "STATUS_APPROVED",
    "STATUS_CHOICES",
    "STATUS_ESCALATED",
    "STATUS_PENDING",
    "STATUS_RECALLED",
    "STATUS_REJECTED",
    "STEP_FIRST_TO_APPROVE",
    "STEP_MAJORITY_VOTE",
    "STEP_PARALLEL",
    "STEP_SEQUENTIAL",
    "STEP_TYPE_CHOICES",
    "STEP_UNANIMOUS",
    "TARGET_MODEL_ACCOUNT",
    "TARGET_MODEL_CHOICES",
    "TARGET_MODEL_CONTACT",
    "TARGET_MODEL_DEAL",
    "TARGET_MODEL_EVENT",
    "TARGET_MODEL_LEAD",
    "TARGET_MODEL_TASK",
    "ApprovalAction",
    "ApprovalDelegation",
    "ApprovalProcess",
    "ApprovalRequest",
    "ApprovalStep",
]
