"""Escalation-rule service layer.

The :class:`EscalationService` is the canonical interface:

* :meth:`evaluate_criteria` — return ``True`` when ``record_data`` matches
  every ``criteria`` clause (exact-match semantics).
* :meth:`check_escalations` — Celery beat (every 15 min). Walk every
  active rule, find records matching ``criteria`` whose ``created_at``
  exceeds ``time_limit_hours``, take the configured ``action``
  (``reassign`` / ``notify`` / ``both``), and log an
  :class:`EscalationLog` row.

The service is deliberately stateless — callers pass plain dicts (and
the optional ORM model instance for ``check_escalations``) so the
service is straightforward to unit-test without an HTTP layer.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import TYPE_CHECKING, Any

from django.db import transaction
from django.db.models import Model
from django.utils import timezone

from escalation_rules.models import (
    ACTION_BOTH,
    ACTION_NOTIFY,
    ACTION_REASSIGN,
    EscalationLog,
    EscalationRule,
)

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization, User

log = logging.getLogger(__name__)


###############################################################################
# Service
###############################################################################


class EscalationService:
    """Stateless service encapsulating the escalation-rule engine."""

    # ------------------------------------------------------------------ helpers

    @staticmethod
    def _resolve_model(target_model: str) -> type[Model] | None:
        """Map a ``target_model`` string to a Django model class."""
        from accounts.models import Account
        from contacts.models import Contact
        from deals.models import Deal
        from leads.models import Lead

        mapping = {
            "deal": Deal,
            "lead": Lead,
            "contact": Contact,
            "account": Account,
        }
        return mapping.get(target_model)

    def evaluate_criteria(self, record_data: dict[str, Any], criteria: dict[str, Any]) -> bool:
        """Return ``True`` when ``record_data`` matches every ``criteria`` clause.

        Exact-match semantics: each ``criteria[field] == record_data[field]``
        comparison is string-coerced so int / Decimal / FK-id all match
        cleanly. Empty ``criteria`` matches every record.
        """
        if not criteria:
            return True
        for field_name, expected in criteria.items():
            actual = record_data.get(field_name)
            if str(actual) != str(expected):
                return False
        return True

    def _resolve_escalate_to(
        self,
        *,
        tenant: "Organization",
        escalate_to: dict[str, Any],
    ) -> "User | None":
        """Resolve a JSON ``escalate_to`` dict into a single user.

        ``escalate_to`` shape mirrors :class:`approvals.models.ApprovalStep.approvers`:
        ``{type, value}`` where ``type`` is one of ``user`` / ``role`` /
        ``team``. We reuse :class:`approvals.services.ApprovalService`'s
        resolver so the semantics stay consistent across the two apps.
        """
        if not isinstance(escalate_to, dict):
            return None
        kind = escalate_to.get("type")
        value = escalate_to.get("value")
        if kind in (None, "") or value in (None, ""):
            return None
        from approvals.services import ApprovalService

        ids = ApprovalService()._resolve_approver_ids(
            tenant=tenant, approvers=[escalate_to]
        )
        if not ids:
            return None
        from api.models import User

        return User.objects.filter(pk=ids[0], is_active_account=True).first()

    # ------------------------------------------------------------------ check_escalations

    def check_escalations(self) -> dict[str, Any]:
        """Celery beat (every 15 min). Walk every active rule + escalate past-due records.

        Returns a summary dict ``{checked, escalated, errors}`` for the
        audit trail. The function is tenant-agnostic — the Celery task
        wraps it in a per-tenant ``tenant_context`` loop.
        """
        now = timezone.now()
        summary: dict[str, Any] = {"checked": 0, "escalated": 0, "errors": 0}
        rules = EscalationRule.objects.filter(is_active=True).select_related("tenant")
        for rule in rules.iterator(chunk_size=200):
            try:
                summary["checked"] += self._process_rule(rule, now)
            except Exception:  # pragma: no cover — defensive
                summary["errors"] += 1
                log.exception(
                    "check_escalations: failed for rule %s", rule.pk
                )
        summary["escalated"] = EscalationLog.objects.filter(
            created_at__gte=now - timedelta(minutes=20)
        ).count()
        return summary

    def _process_rule(self, rule: EscalationRule, now: Any) -> int:
        """Walk every record matching ``rule`` + escalate the past-due ones.

        Returns the number of records inspected (matched the criteria).
        """
        model_cls = self._resolve_model(rule.target_model)
        if model_cls is None:
            return 0
        cutoff = now - timedelta(hours=rule.time_limit_hours)
        # Records created before the cutoff + matching the criteria.
        qs = model_cls.objects.filter(created_at__lt=cutoff)
        # Apply criteria as a Python-side filter (the JSON dict shape is
        # too dynamic for a single ORM filter expression).
        inspected = 0
        for record in qs.iterator(chunk_size=200):
            record_data = self._record_to_dict(record)
            if not self.evaluate_criteria(record_data, rule.criteria):
                continue
            inspected += 1
            # Skip records that have already been escalated by this rule
            # (dedup via the EscalationLog). The lightweight check is
            # "any log for this rule + record in the last
            # time_limit_hours window".
            already_escalated = EscalationLog.objects.filter(
                rule=rule,
                record_module=rule.target_model,
                record_id=str(record.pk),
                created_at__gte=cutoff,
            ).exists()
            if already_escalated:
                continue
            self._escalate_record(rule, record)
        return inspected

    def _escalate_record(self, rule: EscalationRule, record: Model) -> None:
        """Take the configured ``action`` on ``record`` + log an EscalationLog row."""
        user = self._resolve_escalate_to(
            tenant=rule.tenant, escalate_to=rule.escalate_to or {}
        )
        action_taken = rule.action
        with transaction.atomic():
            if rule.action in (ACTION_REASSIGN, ACTION_BOTH) and user is not None:
                # Only reassign when the model has an ``owner`` FK.
                if hasattr(record, "owner_id"):
                    record.owner = user
                    record.save(update_fields=["owner", "updated_at"])
            if rule.action in (ACTION_NOTIFY, ACTION_BOTH):
                self._notify(record, rule, user)
            EscalationLog.objects.create(
                tenant=rule.tenant,
                rule=rule,
                record_module=rule.target_model,
                record_id=str(record.pk),
                escalated_to=user,
                action_taken=action_taken,
                created_at=timezone.now(),
            )

    def _notify(self, record: Model, rule: EscalationRule, user: "User | None") -> None:
        """Best-effort notification dispatch — never raises into the caller."""
        from notifications.services import create_notification

        target_name = str(getattr(record, "name", "") or getattr(record, "pk", ""))
        recipient_id = user.pk if user is not None else None
        if recipient_id is None:
            # Fall back to the tenant admins.
            from approvals.services import ApprovalService

            admin = ApprovalService()._first_admin(rule.tenant)
            if admin is None:
                return
            recipient_id = admin.pk
        try:
            create_notification(
                tenant=rule.tenant,
                actor=None,
                verb="escalated",
                target_module=rule.target_model,
                target_id=str(record.pk),
                target_name=target_name,
                recipient_id=recipient_id,
                data={
                    "title": f"Escalated: {target_name}",
                    "body": (
                        f"{rule.target_model} '{target_name}' exceeded the "
                        f"{rule.time_limit_hours}h SLA on rule "
                        f"'{rule}' and was escalated."
                    ),
                    "rule_id": rule.pk,
                },
            )
        except Exception:  # pragma: no cover — defensive
            log.exception(
                "EscalationService._notify: failed for record %s:%s",
                rule.target_model, record.pk,
            )

    @staticmethod
    def _record_to_dict(record: Model) -> dict[str, Any]:
        """Project ``record`` into a flat dict of concrete-field values."""
        out: dict[str, Any] = {}
        for field in record._meta.concrete_fields:  # type: ignore[attr-defined]
            try:
                out[field.name] = getattr(record, field.attname)
            except Exception:  # pragma: no cover — defensive
                continue
        return out


__all__ = ["EscalationService"]
