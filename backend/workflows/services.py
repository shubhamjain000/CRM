"""Workflow service layer — the canonical interface for the automation engine.

:class:`WorkflowService` is the single entry point used by:

* :mod:`workflows.tasks` — the Celery ``evaluate_workflow_rules`` and
  ``execute_workflow_task`` tasks.
* :mod:`workflows.signals` — the post_save / post_delete signal handlers
  on Lead / Contact / Account / Deal.
* :mod:`workflows.viewsets` — the ``test_run`` / ``metrics`` / ``history``
  actions on :class:`WorkflowRuleViewSet`.

The service is deliberately stateless: callers pass the rule id + target
module/id and the service resolves everything from the ORM.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
from datetime import timedelta
from typing import TYPE_CHECKING, Any

from django.apps import apps
from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone

from .models import (
    ACTION_ADD_TAG,
    ACTION_ALERT,
    ACTION_ASSIGN_RECORD,
    ACTION_CREATE_RECORD,
    ACTION_CREATE_TASK,
    ACTION_DELAY,
    ACTION_HTTP,
    ACTION_IF_ELSE,
    ACTION_LOOP,
    ACTION_NOTIFY_TEAM,
    ACTION_REMOVE_TAG,
    ACTION_SEND_EMAIL,
    ACTION_SEND_SMS,
    ACTION_UPDATE_FIELD,
    ACTION_WEBHOOK,
    ACTION_WHATSAPP,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_RUNNING,
    WorkflowAction,
    WorkflowExecution,
    WorkflowRule,
)

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization, User
    from django.db.models import Model

log = logging.getLogger(__name__)


###############################################################################
# Module → model resolution
###############################################################################


_MODULE_MODEL_PATHS: dict[str, str] = {
    "lead": "leads.Lead",
    "contact": "contacts.Contact",
    "account": "accounts.Account",
    "deal": "deals.Deal",
    "task": "tasks.Task",
}


def _resolve_model(module: str) -> type[Model] | None:
    """Map a ``module`` string to a Django model class. Returns ``None`` if unknown."""
    path = _MODULE_MODEL_PATHS.get(module)
    if path is None:
        return None
    app_label, model_name = path.split(".")
    try:
        return apps.get_model(app_label, model_name)
    except LookupError:
        return None


def _record_to_dict(record: Model) -> dict[str, Any]:
    """Project ``record`` into a flat dict of concrete-field values."""
    out: dict[str, Any] = {}
    for field in record._meta.concrete_fields:  # type: ignore[attr-defined]
        try:
            out[field.name] = getattr(record, field.attname)
        except Exception:  # pragma: no cover — defensive
            continue
    return out


###############################################################################
# Condition evaluator
###############################################################################


class WorkflowService:
    """Stateless service encapsulating the workflow engine."""

    # ------------------------------------------------------------------ conditions

    def evaluate_conditions(
        self, conditions: dict[str, Any], record_data: dict[str, Any]
    ) -> bool:
        """Evaluate a JSON condition tree against ``record_data``.

        Two shapes are accepted:

        * **Field-key form** — ``{"field_name": {"$eq": "value"}, ...}``.
          All clauses must match (logical AND). An empty dict matches every
          record. A scalar value is treated as ``$eq``.
        * **Operator form** — ``{"$and": [...], "$or": [...]}`` /
          ``{"$not": {...}}`` for boolean composition.

        Supported operators: ``$eq``, ``$ne``, ``$gt``, ``$lt``, ``$in``,
        ``$contains``, ``$exists``.
        """
        if not conditions:
            return True
        return self._eval_node(conditions, record_data)

    def _eval_node(self, node: Any, data: dict[str, Any]) -> bool:
        if isinstance(node, dict):
            # Boolean composition operators.
            if "$and" in node:
                return all(self._eval_node(child, data) for child in node["$and"])
            if "$or" in node:
                return any(self._eval_node(child, data) for child in node["$or"])
            if "$not" in node:
                return not self._eval_node(node["$not"], data)
            # Field-key form.
            for field, clause in node.items():
                actual = data.get(field)
                if not self._eval_clause(clause, actual):
                    return False
            return True
        # Bare scalar = truthiness.
        return bool(node)

    def _eval_clause(self, clause: Any, actual: Any) -> bool:
        if isinstance(clause, dict):
            for op, expected in clause.items():
                if not self._eval_op(op, expected, actual):
                    return False
            return True
        # Scalar clause = $eq.
        return str(actual) == str(clause)

    def _eval_op(self, op: str, expected: Any, actual: Any) -> bool:
        if op == "$eq":
            return str(actual) == str(expected)
        if op == "$ne":
            return str(actual) != str(expected)
        if op == "$gt":
            try:
                return float(actual) > float(expected)
            except (TypeError, ValueError):
                return False
        if op == "$lt":
            try:
                return float(actual) < float(expected)
            except (TypeError, ValueError):
                return False
        if op == "$in":
            if not isinstance(expected, (list, tuple, set)):
                return False
            return str(actual) in {str(item) for item in expected}
        if op == "$contains":
            if isinstance(actual, (list, tuple, set, str, dict)):
                return expected in actual
            return False
        if op == "$exists":
            return (actual is not None) == bool(expected)
        log.warning("WorkflowService: unknown operator %s", op)
        return False

    # ------------------------------------------------------------------ evaluate_rules

    def evaluate_rules(
        self,
        instance: Model,
        trigger_type: str,
        trigger_model: str,
        user: "User | None" = None,
    ) -> list[int]:
        """Find matching active rules for ``instance`` + enqueue each.

        Returns the list of enqueued rule ids (for diagnostics / tests).
        Matching rules are: same tenant, ``is_active=True``, same
        ``trigger_type``, same ``trigger_model`` (when the rule specifies
        one), and ``trigger_conditions`` evaluates true against the record.
        """
        from .tasks import execute_workflow_task

        tenant = getattr(instance, "tenant", None)
        if tenant is None:
            return []
        record_data = _record_to_dict(instance)
        qs = WorkflowRule.objects.filter(
            tenant=tenant, is_active=True, trigger_type=trigger_type
        ).filter(Q(trigger_model=trigger_model) | Q(trigger_model__isnull=True))
        enqueued: list[int] = []
        for rule in qs.iterator(chunk_size=200):
            try:
                if not self.evaluate_conditions(rule.trigger_conditions or {}, record_data):
                    continue
            except Exception:  # pragma: no cover — defensive
                log.exception("evaluate_rules: condition eval failed for rule %s", rule.pk)
                continue
            try:
                execute_workflow_task.delay(
                    rule_id=rule.pk,
                    target_module=trigger_model,
                    target_id=str(instance.pk),
                )
                enqueued.append(rule.pk)
            except Exception:  # pragma: no cover — defensive
                log.exception(
                    "evaluate_rules: failed to enqueue rule %s for %s:%s",
                    rule.pk, trigger_model, instance.pk,
                )
        return enqueued

    # ------------------------------------------------------------------ execute_workflow

    def execute_workflow(
        self, rule_id: int, target_module: str, target_id: str
    ) -> WorkflowExecution:
        """Create a :class:`WorkflowExecution`, run each action, return the row.

        Each action runs inside its own try/except; an action failure does
        *not* abort the whole run (unless the action is ``delay`` which
        suspends the run via a Celery countdown). The execution's
        ``actions_executed`` log captures every action's result.
        """
        rule = WorkflowRule.objects.filter(pk=rule_id).first()
        if rule is None:
            log.warning("execute_workflow: rule %s missing; aborting.", rule_id)
            raise WorkflowRule.DoesNotExist(f"WorkflowRule {rule_id} not found")
        execution = WorkflowExecution.objects.create(
            tenant=rule.tenant,
            rule=rule,
            target_module=target_module,
            target_id=str(target_id),
            status=STATUS_RUNNING,
            started_at=timezone.now(),
            actions_executed=[],
        )
        actions = list(
            WorkflowAction.objects.filter(rule=rule).order_by("order")
        )
        log_data: list[dict[str, Any]] = []
        context = self._build_context(rule, target_module, target_id)
        failed = False
        for action in actions:
            entry: dict[str, Any] = {
                "action_id": action.pk,
                "action_type": action.action_type,
                "order": action.order,
                "status": STATUS_RUNNING,
                "started_at": timezone.now().isoformat(),
            }
            try:
                result = self.execute_action(action, context)
                entry["status"] = STATUS_COMPLETED
                entry["result"] = result
            except _DelaySuspend as suspend:
                # Delay = schedule a follow-up execution after ``suspend.countdown``.
                entry["status"] = STATUS_COMPLETED
                entry["result"] = {"suspended": True, "resume_in_seconds": suspend.countdown}
                log_data.append(entry)
                execution.actions_executed = log_data
                execution.save(update_fields=["actions_executed", "updated_at"])
                self._schedule_resume(rule, target_module, target_id, suspend.countdown, action.order)
                return execution
            except Exception as exc:  # noqa: BLE001 — capture any action error
                failed = True
                entry["status"] = STATUS_FAILED
                entry["error"] = str(exc)
                log.exception(
                    "execute_workflow: action %s (%s) failed", action.pk, action.action_type
                )
            entry["completed_at"] = timezone.now().isoformat()
            log_data.append(entry)
        execution.actions_executed = log_data
        execution.status = STATUS_FAILED if failed else STATUS_COMPLETED
        execution.completed_at = timezone.now()
        execution.save(
            update_fields=["actions_executed", "status", "completed_at", "updated_at"]
        )
        # Update the rule's run counters.
        update_kwargs: dict[str, Any] = {
            "run_count": F("run_count") + 1,
            "last_run_at": timezone.now(),
        }
        if failed:
            update_kwargs["error_count"] = F("error_count") + 1
        WorkflowRule.objects.filter(pk=rule.pk).update(**update_kwargs)
        if failed:
            self._alert_admins(rule, execution)
        return execution

    # ------------------------------------------------------------------ context

    def _build_context(
        self, rule: WorkflowRule, target_module: str, target_id: str
    ) -> dict[str, Any]:
        """Build the execution context: rule, record (if resolvable), tenant."""
        model_cls = _resolve_model(target_module)
        record: Model | None = None
        record_data: dict[str, Any] = {}
        if model_cls is not None:
            record = model_cls.objects.filter(pk=target_id).first()
            if record is not None:
                record_data = _record_to_dict(record)
        return {
            "rule": rule,
            "tenant": rule.tenant,
            "target_module": target_module,
            "target_id": str(target_id),
            "record": record,
            "record_data": record_data,
        }

    # ------------------------------------------------------------------ execute_action

    def execute_action(self, action: WorkflowAction, context: dict[str, Any]) -> Any:
        """Dispatch ``action`` by ``action_type``. Returns a result dict."""
        cfg = action.config or {}
        atype = action.action_type
        if atype == ACTION_SEND_EMAIL:
            return self._action_send_email(cfg, context)
        if atype == ACTION_UPDATE_FIELD:
            return self._action_update_field(cfg, context)
        if atype == ACTION_CREATE_RECORD:
            return self._action_create_record(cfg, context)
        if atype == ACTION_CREATE_TASK:
            return self._action_create_task(cfg, context)
        if atype == ACTION_WEBHOOK:
            return self._action_webhook(cfg, context)
        if atype == ACTION_HTTP:
            return self._action_http(cfg, context)
        if atype == ACTION_ALERT:
            return self._action_alert(cfg, context)
        if atype == ACTION_ASSIGN_RECORD:
            return self._action_assign_record(cfg, context)
        if atype == ACTION_SEND_SMS:
            return self._action_send_sms(cfg, context)
        if atype == ACTION_WHATSAPP:
            return self._action_whatsapp(cfg, context)
        if atype == ACTION_DELAY:
            return self._action_delay(cfg, context)
        if atype == ACTION_IF_ELSE:
            return self._action_if_else(cfg, context)
        if atype == ACTION_LOOP:
            return self._action_loop(cfg, context)
        if atype == ACTION_ADD_TAG:
            return self._action_add_tag(cfg, context)
        if atype == ACTION_REMOVE_TAG:
            return self._action_remove_tag(cfg, context)
        if atype == ACTION_NOTIFY_TEAM:
            return self._action_notify_team(cfg, context)
        if atype == "custom_function":
            return {"skipped": True, "reason": "custom_function not registered"}
        if atype == "subscribe_sequence":
            return {"skipped": True, "reason": "subscribe_sequence not configured"}
        raise ValueError(f"Unknown action_type: {atype!r}")

    # ------------------------------------------------------------------ action impls

    def _action_send_email(self, cfg: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        """Dispatch an email via the notifications transport."""
        from notifications.services import send_email_notification

        tenant: "Organization" = context["tenant"]
        recipient = self._resolve_user(cfg.get("to"), tenant)
        if recipient is None:
            return {"skipped": True, "reason": "no_recipient"}
        subject = self._render(cfg.get("subject", ""), context)
        body = self._render(cfg.get("body", ""), context)
        send_email_notification(recipient, subject, body)
        return {"sent": True, "to": recipient.email}

    def _action_update_field(self, cfg: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        """Update a single field on the target record."""
        record = context.get("record")
        if record is None:
            return {"skipped": True, "reason": "no_record"}
        field_name = cfg.get("field")
        value = self._render_value(cfg.get("value"), context)
        if not field_name:
            raise ValueError("update_field requires 'field'")
        if not hasattr(record, field_name):
            raise ValueError(f"Record has no field {field_name!r}")
        setattr(record, field_name, value)
        record.save(update_fields=[field_name, "updated_at"])
        return {"updated": True, "field": field_name, "value": value}

    def _action_create_record(self, cfg: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        """Create a new record in the configured target model with field mappings."""
        module = cfg.get("module") or context["target_module"]
        model_cls = _resolve_model(module)
        if model_cls is None:
            raise ValueError(f"Unknown module: {module!r}")
        fields = cfg.get("fields", {}) or {}
        attrs: dict[str, Any] = {"tenant": context["tenant"]}
        for fname, raw in fields.items():
            attrs[fname] = self._render_value(raw, context)
        with transaction.atomic():
            instance = model_cls.objects.create(**attrs)
        return {"created": True, "module": module, "id": instance.pk}

    def _action_create_task(self, cfg: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        """Create a :class:`tasks.Task` with title / due_date / assignee."""
        from api.models import User
        from tasks.models import Task

        tenant: "Organization" = context["tenant"]
        assignee = self._resolve_user(cfg.get("assignee") or cfg.get("assignee_id"), tenant)
        if assignee is None:
            raise ValueError("create_task requires a resolvable assignee")
        title = self._render(cfg.get("title", "Follow-up task"), context)
        due = cfg.get("due_date")
        task = Task.objects.create(
            tenant=tenant,
            title=title,
            description=self._render(cfg.get("description", ""), context),
            assignee=assignee,
            owner=assignee,
            related_module=context["target_module"],
            related_id=context["target_id"],
            due_date=due,
            created_by=cfg.get("created_by_id") and User.objects.filter(pk=cfg["created_by_id"]).first(),
        )
        return {"created": True, "task_id": task.pk}

    def _action_webhook(self, cfg: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        """POST a signed JSON payload to an external URL (HMAC-SHA256)."""
        import requests

        url = cfg.get("url")
        if not url:
            raise ValueError("webhook requires 'url'")
        secret = cfg.get("secret", "")
        payload = self._render_payload(cfg.get("payload", {}), context)
        body = json.dumps(payload, default=str)
        signature = ""
        if secret:
            signature = hmac.new(
                secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256
            ).hexdigest()
        headers = {"Content-Type": "application/json"}
        if signature:
            headers["X-Webhook-Signature"] = signature
        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                resp = requests.post(url, data=body, headers=headers, timeout=30)
                return {
                    "status_code": resp.status_code,
                    "attempts": attempt + 1,
                }
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                continue
        raise RuntimeError(f"webhook failed after 3 attempts: {last_exc}")

    def _action_http(self, cfg: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        """Generic HTTP call (method / url / headers / body)."""
        import requests

        method = (cfg.get("method") or "GET").upper()
        url = cfg.get("url")
        if not url:
            raise ValueError("http requires 'url'")
        headers = cfg.get("headers") or {}
        body = self._render_payload(cfg.get("body"), context)
        resp = requests.request(
            method, url, headers=headers, json=body, timeout=30
        )
        return {"status_code": resp.status_code}

    def _action_alert(self, cfg: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        """Multi-channel alert — in-app + email + push notification."""
        from notifications.services import create_notification

        tenant: "Organization" = context["tenant"]
        recipient = self._resolve_user(cfg.get("to"), tenant)
        if recipient is None:
            return {"skipped": True, "reason": "no_recipient"}
        title = self._render(cfg.get("title", "Workflow alert"), context)
        body = self._render(cfg.get("body", ""), context)
        create_notification(
            tenant=tenant,
            actor=None,
            verb="alerted",
            target_module=context["target_module"],
            target_id=context["target_id"],
            target_name=title,
            recipient=recipient,
            data={"title": title, "body": body, "rule_id": context["rule"].pk},
        )
        return {"alerted": True, "to": recipient.pk}

    def _action_assign_record(self, cfg: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        """Reassign the target record's ``owner``."""
        record = context.get("record")
        if record is None:
            return {"skipped": True, "reason": "no_record"}
        tenant: "Organization" = context["tenant"]
        new_owner = self._resolve_user(cfg.get("user") or cfg.get("user_id"), tenant)
        if new_owner is None:
            raise ValueError("assign_record requires a resolvable user")
        if not hasattr(record, "owner"):
            raise ValueError("Record has no 'owner' field")
        record.owner = new_owner
        record.save(update_fields=["owner", "updated_at"])
        return {"assigned": True, "owner_id": new_owner.pk}

    def _action_send_sms(self, cfg: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        """Send an SMS via the notifications transport."""
        from notifications.services import send_sms_notification

        tenant: "Organization" = context["tenant"]
        recipient = self._resolve_user(cfg.get("to"), tenant)
        if recipient is None:
            return {"skipped": True, "reason": "no_recipient"}
        body = self._render(cfg.get("body", ""), context)
        send_sms_notification(recipient, body)
        return {"sent": True, "to": recipient.pk}

    def _action_whatsapp(self, cfg: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        """WhatsApp — stubbed (returns sent=True when a recipient is configured)."""
        return {"sent": False, "reason": "whatsapp_transport_not_configured"}

    def _action_delay(self, cfg: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        """Suspend the run for ``hours`` / ``days`` / ``minutes``."""
        hours = float(cfg.get("hours", 0) or 0)
        days = float(cfg.get("days", 0) or 0)
        minutes = float(cfg.get("minutes", 0) or 0)
        total = int(timedelta(hours=hours, days=days, minutes=minutes).total_seconds())
        if total <= 0:
            return {"skipped": True, "reason": "zero_delay"}
        raise _DelaySuspend(countdown=total)

    def _action_if_else(self, cfg: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        """Evaluate a condition and report which branch to take."""
        condition = cfg.get("conditions", {}) or {}
        matched = self.evaluate_conditions(condition, context["record_data"])
        return {"branch": "then" if matched else "else", "matched": matched}

    def _action_loop(self, cfg: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        """Iterate over a list value — returns the iteration count (execution
        of the per-iteration actions is the caller's responsibility)."""
        items = self._render_value(cfg.get("items"), context)
        if not isinstance(items, (list, tuple)):
            return {"iterations": 0, "reason": "items_not_list"}
        return {"iterations": len(items)}

    def _action_add_tag(self, cfg: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        """Add a tag to the record's ``tags`` JSONField list."""
        record = context.get("record")
        if record is None:
            return {"skipped": True, "reason": "no_record"}
        if not hasattr(record, "tags"):
            return {"skipped": True, "reason": "record_has_no_tags"}
        tag = self._render(cfg.get("tag", ""), context)
        if not tag:
            raise ValueError("add_tag requires 'tag'")
        tags = list(getattr(record, "tags", []) or [])
        if tag not in tags:
            tags.append(tag)
            record.tags = tags
            record.save(update_fields=["tags", "updated_at"])
        return {"added": True, "tag": tag}

    def _action_remove_tag(self, cfg: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        """Remove a tag from the record's ``tags`` JSONField list."""
        record = context.get("record")
        if record is None:
            return {"skipped": True, "reason": "no_record"}
        if not hasattr(record, "tags"):
            return {"skipped": True, "reason": "record_has_no_tags"}
        tag = self._render(cfg.get("tag", ""), context)
        tags = list(getattr(record, "tags", []) or [])
        if tag in tags:
            tags.remove(tag)
            record.tags = tags
            record.save(update_fields=["tags", "updated_at"])
            return {"removed": True, "tag": tag}
        return {"removed": False, "tag": tag}

    def _action_notify_team(self, cfg: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        """Send a notification to every member of a team."""
        from api.models import Team, TenantMembership
        from notifications.services import create_notification

        tenant: "Organization" = context["tenant"]
        team_id = cfg.get("team_id")
        title = self._render(cfg.get("title", "Team notification"), context)
        body = self._render(cfg.get("body", ""), context)
        if team_id is None:
            return {"skipped": True, "reason": "no_team"}
        team = Team.objects.filter(tenant=tenant, pk=team_id).first()
        if team is None:
            return {"skipped": True, "reason": "team_not_found"}
        memberships = TenantMembership.objects.filter(
            tenant=tenant, is_active=True
        ).values_list("user_id", flat=True)
        sent = 0
        for uid in memberships:
            create_notification(
                tenant=tenant,
                actor=None,
                verb="notified",
                target_module=context["target_module"],
                target_id=context["target_id"],
                target_name=title,
                recipient_id=uid,
                data={"title": title, "body": body, "team_id": team.pk},
            )
            sent += 1
        return {"notified": True, "team_id": team.pk, "recipients": sent}

    # ------------------------------------------------------------------ helpers

    def _resolve_user(self, ref: Any, tenant: "Organization") -> "User | None":
        """Resolve a user reference (User instance, id, or email) to a User."""
        from api.models import User

        if ref is None:
            return None
        if isinstance(ref, User):
            return ref
        if isinstance(ref, int):
            return User.objects.filter(pk=ref).first()
        if isinstance(ref, str):
            if ref.isdigit():
                return User.objects.filter(pk=int(ref)).first()
            return User.objects.filter(email__iexact=ref).first()
        return None

    def _render(self, template: str, context: dict[str, Any]) -> str:
        """Render ``{{field}}`` placeholders from the record_data."""
        if not isinstance(template, str):
            return str(template)
        data = context.get("record_data", {}) or {}
        out = template
        for key, value in data.items():
            out = out.replace(f"{{{{{key}}}}}", str(value))
        return out

    def _render_value(self, value: Any, context: dict[str, Any]) -> Any:
        """Render a value that may be a string template or a literal."""
        if isinstance(value, str):
            return self._render(value, context)
        return value

    def _render_payload(self, payload: Any, context: dict[str, Any]) -> Any:
        """Recursively render a JSON payload (dicts / lists / strings)."""
        if isinstance(payload, dict):
            return {k: self._render_payload(v, context) for k, v in payload.items()}
        if isinstance(payload, list):
            return [self._render_payload(v, context) for v in payload]
        if isinstance(payload, str):
            return self._render(payload, context)
        return payload

    def _schedule_resume(
        self,
        rule: WorkflowRule,
        target_module: str,
        target_id: str,
        countdown: int,
        from_order: int,
    ) -> None:
        """Schedule a follow-up execution after a ``delay`` action."""
        from .tasks import execute_workflow_task

        try:
            execute_workflow_task.apply_async(
                kwargs={
                    "rule_id": rule.pk,
                    "target_module": target_module,
                    "target_id": target_id,
                    "from_order": from_order + 1,
                },
                countdown=countdown,
            )
        except Exception:  # pragma: no cover — defensive
            log.exception("execute_workflow: failed to schedule delay resume")

    def _alert_admins(self, rule: WorkflowRule, execution: WorkflowExecution) -> None:
        """Best-effort alert to tenant admins when a workflow fails."""
        from notifications.services import create_notification

        try:
            from approvals.services import ApprovalService

            admin = ApprovalService()._first_admin(rule.tenant)  # noqa: SLF001
            if admin is None:
                return
            create_notification(
                tenant=rule.tenant,
                actor=None,
                verb="alerted",
                target_module="workflow",
                target_id=str(rule.pk),
                target_name=rule.name,
                recipient=admin,
                data={
                    "title": f"Workflow failed: {rule.name}",
                    "body": (
                        f"Execution {execution.pk} on {execution.target_module}:"
                        f"{execution.target_id} failed."
                    ),
                    "rule_id": rule.pk,
                    "execution_id": execution.pk,
                },
            )
        except Exception:  # pragma: no cover — defensive
            log.exception("_alert_admins: failed for rule %s", rule.pk)

    # ------------------------------------------------------------------ templates + metrics

    def get_templates(self) -> list[dict[str, Any]]:
        """Return pre-built workflow templates (rule + actions blueprints)."""
        return [
            {
                "name": "Welcome new lead",
                "trigger_type": "record_create",
                "trigger_model": "lead",
                "trigger_conditions": {},
                "actions": [
                    {"action_type": ACTION_SEND_EMAIL, "config": {
                        "subject": "Welcome to {{company}}!",
                        "body": "Hi {{first_name}}, thanks for reaching out.",
                    }},
                    {"action_type": ACTION_CREATE_TASK, "config": {
                        "title": "Call new lead {{first_name}}",
                        "due_date": None,
                    }},
                ],
            },
            {
                "name": "Follow-up reminder",
                "trigger_type": "schedule",
                "trigger_model": "deal",
                "trigger_conditions": {},
                "actions": [
                    {"action_type": ACTION_NOTIFY_TEAM, "config": {
                        "title": "Follow-up reminder",
                        "body": "Deal {{name}} has no activity in 7 days.",
                    }},
                ],
            },
            {
                "name": "Win deal celebration",
                "trigger_type": "field_change",
                "trigger_model": "deal",
                "trigger_conditions": {"stage": {"$eq": "Closed Won"}},
                "actions": [
                    {"action_type": ACTION_ALERT, "config": {
                        "title": "Deal won!",
                        "body": "Congratulations on closing {{name}}.",
                    }},
                ],
            },
            {
                "name": "Re-engage dormant lead",
                "trigger_type": "schedule",
                "trigger_model": "lead",
                "trigger_conditions": {},
                "actions": [
                    {"action_type": ACTION_SEND_EMAIL, "config": {
                        "subject": "Still interested?",
                        "body": "We haven't heard from you in a while.",
                    }},
                    {"action_type": ACTION_ADD_TAG, "config": {"tag": "dormant"}},
                ],
            },
            {
                "name": "Approval reminder escalation",
                "trigger_type": "approval_approved",
                "trigger_model": None,
                "trigger_conditions": {},
                "actions": [
                    {"action_type": ACTION_NOTIFY_TEAM, "config": {
                        "title": "Approval completed",
                        "body": "Approval on {{target_id}} is complete.",
                    }},
                ],
            },
        ]

    def get_metrics(self, rule_id: int) -> dict[str, Any]:
        """Return aggregate run metrics for a rule."""
        qs = WorkflowExecution.objects.filter(rule_id=rule_id)
        total = qs.count()
        if total == 0:
            return {
                "total_runs": 0,
                "success_rate": 0.0,
                "avg_execution_time": 0.0,
                "last_run": None,
                "error_count": 0,
            }
        succeeded = qs.filter(status=STATUS_COMPLETED).count()
        failed = qs.filter(status=STATUS_FAILED).count()
        # Average wall-clock execution time (seconds) — computed in Python so
        # the engine is portable across SQLite / Postgres / MySQL.
        completed = qs.exclude(completed_at__isnull=True)
        durations = [
            (exec_row.completed_at - exec_row.started_at).total_seconds()
            for exec_row in completed
            if exec_row.completed_at and exec_row.started_at
        ]
        avg_seconds = sum(durations) / len(durations) if durations else 0.0
        last = qs.order_by("-started_at").first()
        return {
            "total_runs": total,
            "success_rate": round(succeeded / total, 4),
            "avg_execution_time": round(avg_seconds, 3),
            "last_run": last.started_at.isoformat() if last else None,
            "error_count": failed,
        }


###############################################################################
# Internal helpers
###############################################################################


class _DelaySuspend(Exception):
    """Raised by ``delay`` actions to suspend the run with a Celery countdown."""

    def __init__(self, countdown: int) -> None:
        super().__init__(f"delay {countdown}s")
        self.countdown = countdown


__all__ = ["WorkflowService"]
