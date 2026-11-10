"""Workflow-automation models — tenant-scoped rules + actions + execution log.

Design notes
------------
* All three models inherit :class:`api.models.TenantModel` (tenant FK +
  ``created_at`` / ``updated_at``) and are filtered through
  :class:`api.managers.TenantManager`.
* :class:`WorkflowRule` is the trigger + conditions; :class:`WorkflowAction`
  is the ordered, type-specific work to run; :class:`WorkflowExecution` is
  the append-only audit trail of every run.
* ``trigger_conditions`` / ``config`` are :class:`~django.db.models.JSONField`
  dicts so the rule shape can evolve without a migration. The
  :class:`workflows.services.WorkflowService` interprets both.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import TenantModel, User


###############################################################################
# Constants — trigger types
###############################################################################


TRIGGER_RECORD_CREATE = "record_create"
TRIGGER_RECORD_UPDATE = "record_update"
TRIGGER_RECORD_DELETE = "record_delete"
TRIGGER_FIELD_CHANGE = "field_change"
TRIGGER_SCHEDULE = "schedule"
TRIGGER_SIGNAL = "signal"
TRIGGER_WEBHOOK_RECEIVED = "webhook_received"
TRIGGER_MANUAL = "manual"
TRIGGER_APPROVAL_APPROVED = "approval_approved"
TRIGGER_APPROVAL_REJECTED = "approval_rejected"
TRIGGER_BLUEPRINT_TRANSITION = "blueprint_transition"

TRIGGER_CHOICES = [
    (TRIGGER_RECORD_CREATE, "Record create"),
    (TRIGGER_RECORD_UPDATE, "Record update"),
    (TRIGGER_RECORD_DELETE, "Record delete"),
    (TRIGGER_FIELD_CHANGE, "Field change"),
    (TRIGGER_SCHEDULE, "Schedule"),
    (TRIGGER_SIGNAL, "Signal"),
    (TRIGGER_WEBHOOK_RECEIVED, "Webhook received"),
    (TRIGGER_MANUAL, "Manual"),
    (TRIGGER_APPROVAL_APPROVED, "Approval approved"),
    (TRIGGER_APPROVAL_REJECTED, "Approval rejected"),
    (TRIGGER_BLUEPRINT_TRANSITION, "Blueprint transition"),
]


###############################################################################
# Constants — action types
###############################################################################


ACTION_SEND_EMAIL = "send_email"
ACTION_UPDATE_FIELD = "update_field"
ACTION_CREATE_RECORD = "create_record"
ACTION_CREATE_TASK = "create_task"
ACTION_WEBHOOK = "webhook"
ACTION_CUSTOM_FUNCTION = "custom_function"
ACTION_ALERT = "alert"
ACTION_ASSIGN_RECORD = "assign_record"
ACTION_SEND_SMS = "send_sms"
ACTION_WHATSAPP = "whatsapp"
ACTION_DELAY = "delay"
ACTION_IF_ELSE = "if_else"
ACTION_LOOP = "loop"
ACTION_HTTP = "http"
ACTION_ADD_TAG = "add_tag"
ACTION_REMOVE_TAG = "remove_tag"
ACTION_SUBSCRIBE_SEQUENCE = "subscribe_sequence"
ACTION_NOTIFY_TEAM = "notify_team"

ACTION_CHOICES = [
    (ACTION_SEND_EMAIL, "Send email"),
    (ACTION_UPDATE_FIELD, "Update field"),
    (ACTION_CREATE_RECORD, "Create record"),
    (ACTION_CREATE_TASK, "Create task"),
    (ACTION_WEBHOOK, "Webhook"),
    (ACTION_CUSTOM_FUNCTION, "Custom function"),
    (ACTION_ALERT, "Alert"),
    (ACTION_ASSIGN_RECORD, "Assign record"),
    (ACTION_SEND_SMS, "Send SMS"),
    (ACTION_WHATSAPP, "WhatsApp"),
    (ACTION_DELAY, "Delay"),
    (ACTION_IF_ELSE, "If / else"),
    (ACTION_LOOP, "Loop"),
    (ACTION_HTTP, "HTTP"),
    (ACTION_ADD_TAG, "Add tag"),
    (ACTION_REMOVE_TAG, "Remove tag"),
    (ACTION_SUBSCRIBE_SEQUENCE, "Subscribe sequence"),
    (ACTION_NOTIFY_TEAM, "Notify team"),
]


###############################################################################
# Constants — execution status
###############################################################################


STATUS_RUNNING = "running"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
STATUS_CHOICES = [
    (STATUS_RUNNING, "Running"),
    (STATUS_COMPLETED, "Completed"),
    (STATUS_FAILED, "Failed"),
]


###############################################################################
# WorkflowRule
###############################################################################


class WorkflowRule(TenantModel):
    """A tenant-scoped workflow rule — trigger + conditions + ordered actions.

    The Celery task :func:`workflows.tasks.evaluate_workflow_rules` finds
    matching active rules for a record event and, for each, enqueues
    :func:`workflows.tasks.execute_workflow_task`. The execution task loads
    the rule's ordered :class:`WorkflowAction` rows and dispatches each
    through :meth:`workflows.services.WorkflowService.execute_action`.
    """

    name = models.CharField(max_length=255, db_index=True)
    trigger_type = models.CharField(
        max_length=32, choices=TRIGGER_CHOICES, db_index=True
    )
    trigger_model = models.CharField(
        max_length=32,
        null=True,
        blank=True,
        db_index=True,
        help_text="Which CRM module this rule applies to (lead/contact/account/deal).",
    )
    trigger_conditions = models.JSONField(
        default=dict,
        blank=True,
        help_text=(
            "JSON condition tree evaluated against the record. Supports "
            "$eq / $ne / $gt / $lt / $in / $contains / $exists."
        ),
    )
    is_active = models.BooleanField(default=True, db_index=True)
    version = models.PositiveIntegerField(default=1)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="workflow_rules",
    )
    last_run_at = models.DateTimeField(null=True, blank=True)
    run_count = models.PositiveIntegerField(default=0)
    error_count = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "workflows_workflowrule"
        verbose_name = "workflow rule"
        verbose_name_plural = "workflow rules"
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["tenant", "is_active", "trigger_type", "trigger_model"],
                name="wfrule_active_trigger_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.trigger_type})"


###############################################################################
# WorkflowAction
###############################################################################


class WorkflowAction(TenantModel):
    """A single ordered action attached to a :class:`WorkflowRule`.

    The ``config`` JSONField holds the type-specific payload — e.g. for
    ``send_email``: ``{to, subject, body}``; for ``update_field``:
    ``{field, value}``; for ``if_else``: ``{conditions, then, else}``.
    See :meth:`workflows.services.WorkflowService.execute_action` for the
    per-type contract.
    """

    rule = models.ForeignKey(
        WorkflowRule,
        on_delete=models.CASCADE,
        related_name="actions",
        db_index=True,
    )
    order = models.PositiveIntegerField(default=0)
    action_type = models.CharField(
        max_length=32, choices=ACTION_CHOICES, db_index=True
    )
    config = models.JSONField(
        default=dict,
        blank=True,
        help_text="Type-specific configuration payload.",
    )

    class Meta:
        db_table = "workflows_workflowaction"
        verbose_name = "workflow action"
        verbose_name_plural = "workflow actions"
        ordering = ["order"]
        indexes = [
            models.Index(fields=["rule", "order"], name="wfaction_rule_order_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.rule} → {self.action_type} #{self.order}"


###############################################################################
# WorkflowExecution
###############################################################################


class WorkflowExecution(TenantModel):
    """Append-only audit trail of a single workflow run.

    Rows are created by :meth:`workflows.services.WorkflowService.execute_workflow`.
    The ``rule`` FK is SET_NULL so deleting a rule doesn't cascade onto the
    log. ``actions_executed`` is a list of ``{action_id, action_type,
    status, result, started_at, completed_at, error}`` dicts — one per
    action attempted.
    """

    rule = models.ForeignKey(
        WorkflowRule,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="executions",
        db_index=True,
    )
    target_module = models.CharField(max_length=32, db_index=True)
    target_id = models.CharField(max_length=64, db_index=True)
    status = models.CharField(
        max_length=16, choices=STATUS_CHOICES, default=STATUS_RUNNING, db_index=True
    )
    started_at = models.DateTimeField(default=timezone.now, db_index=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    error_message = models.TextField(blank=True, default="")
    actions_executed = models.JSONField(
        default=list,
        blank=True,
        help_text="Per-action execution log: [{action_id, action_type, status, result}].",
    )

    class Meta:
        db_table = "workflows_workflowexecution"
        verbose_name = "workflow execution"
        verbose_name_plural = "workflow executions"
        ordering = ["-started_at"]
        indexes = [
            models.Index(
                fields=["tenant", "rule", "created_at"],
                name="wfexec_rule_created_idx",
            ),
            models.Index(fields=["tenant", "status"], name="wfexec_status_idx"),
        ]

    def __str__(self) -> str:
        return (
            f"{self.target_module}:{self.target_id} → "
            f"{self.status} @ {self.started_at:%Y-%m-%d %H:%M}"
        )


__all__ = [
    "ACTION_ADD_TAG",
    "ACTION_ALERT",
    "ACTION_ASSIGN_RECORD",
    "ACTION_CHOICES",
    "ACTION_CREATE_RECORD",
    "ACTION_CREATE_TASK",
    "ACTION_CUSTOM_FUNCTION",
    "ACTION_DELAY",
    "ACTION_HTTP",
    "ACTION_IF_ELSE",
    "ACTION_LOOP",
    "ACTION_NOTIFY_TEAM",
    "ACTION_REMOVE_TAG",
    "ACTION_SEND_EMAIL",
    "ACTION_SEND_SMS",
    "ACTION_SUBSCRIBE_SEQUENCE",
    "ACTION_UPDATE_FIELD",
    "ACTION_WEBHOOK",
    "ACTION_WHATSAPP",
    "STATUS_CHOICES",
    "STATUS_COMPLETED",
    "STATUS_FAILED",
    "STATUS_RUNNING",
    "TRIGGER_APPROVAL_APPROVED",
    "TRIGGER_APPROVAL_REJECTED",
    "TRIGGER_BLUEPRINT_TRANSITION",
    "TRIGGER_CHOICES",
    "TRIGGER_FIELD_CHANGE",
    "TRIGGER_MANUAL",
    "TRIGGER_RECORD_CREATE",
    "TRIGGER_RECORD_DELETE",
    "TRIGGER_RECORD_UPDATE",
    "TRIGGER_SCHEDULE",
    "TRIGGER_SIGNAL",
    "TRIGGER_WEBHOOK_RECEIVED",
    "WorkflowAction",
    "WorkflowExecution",
    "WorkflowRule",
]
