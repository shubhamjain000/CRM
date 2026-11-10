"""Blueprint engine — service layer (Zoho Blueprint equivalent).

The :class:`BlueprintService` is the canonical interface for:

* **Validating** a transition (:meth:`validate_transition`) without
  executing it — used by the UI to enable / disable the "Move to stage"
  buttons.
* **Executing** a transition (:meth:`execute_transition`) atomically —
  validates, runs the source state's ``exit_actions``, moves the deal,
  runs the target state's ``entry_actions``, logs the
  :class:`deals.models.DealStageHistory` row, runs the transition's
  ``post_transition_actions``, and — if an approval gate is set — flags
  the result + creates an approval-request notification.
* **Listing** the transitions available to the current user
  (:meth:`get_available_transitions`) with per-target block reasons.
* **Auto-creating** an execution when a deal lands in a pipeline with an
  active blueprint (:meth:`enforce_on_create`) — called by the
  :mod:`blueprint.signals` ``post_save`` receiver.
* **Timer sweep** (:meth:`check_timers`) — Celery beat (hourly). Fires
  every :class:`blueprint.models.BlueprintTimer` whose ``hours`` have
  elapsed since the deal entered its current state.
* **Compliance** (:meth:`get_compliance_report`, :meth:`get_stuck_deals`)
  — surfaces how many deals are following the blueprint vs. ad-hoc.

The service is deliberately stateless — callers pass the deal (and the
actor) and get back either the mutated execution or a structured result
dict. Persistence side effects (history row, activity log, notification)
are co-located in :meth:`execute_transition` so all writes happen in a
single transaction.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from decimal import Decimal, InvalidOperation
from typing import TYPE_CHECKING, Any

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from blueprint.models import (
    Blueprint,
    BlueprintExecution,
    BlueprintState,
    BlueprintTimer,
    BlueprintTransition,
    CONDITION_EQUALS,
    CONDITION_GREATER_THAN,
    CONDITION_IN,
    CONDITION_LESS_THAN,
    CONDITION_NOT_EMPTY,
    CONDITION_NOT_EQUALS,
    STATE_TYPE_TERMINAL,
    TIMER_ACTION_AUTO_TRANSITION,
    TIMER_ACTION_ESCALATE,
    TIMER_ACTION_NOTIFY,
)
from deals.models import Deal, DealStageHistory
from deals.models_pipeline import Pipeline

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization, User

    from blueprint.models import BlueprintFieldRequirement

log = logging.getLogger(__name__)


###############################################################################
# Condition evaluation
###############################################################################


#: JSON operators supported by :meth:`BlueprintService.evaluate_condition`.
_SUPPORTED_OPERATORS = {"$gt", "$lt", "$gte", "$lte", "$eq", "$ne", "$in", "$exists"}


def _coerce_decimal(value: Any) -> Decimal | None:
    """Best-effort coercion of ``value`` into a :class:`Decimal`."""
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def _get_field(deal: Deal, field_name: str) -> Any:
    """Read ``field_name`` off ``deal`` (attribute or related-id)."""
    # Allow ``stage_id`` / ``pipeline_id`` / etc. to be read without
    # triggering a DB hit by stripping the ``_id`` suffix.
    return getattr(deal, field_name, None)


###############################################################################
# Service
###############################################################################


class BlueprintService:
    """Stateless service encapsulating the blueprint engine business rules.

    All public methods accept plain ORM objects (``Deal``, ``Pipeline``,
    ``BlueprintState``, ``User``) so the service is straightforward to
    unit-test without an HTTP layer. Callers are expected to have already
    set the thread-local tenant context (see
    :func:`api.managers.tenant_context`) when invoking write paths.
    """

    # ------------------------------------------------------------------ helpers

    @staticmethod
    def _resolve_role_name(*, tenant: "Organization", user: "User") -> str | None:
        """Return the (lowercased) name of the user's role in ``tenant``."""
        from api.models import TenantMembership

        membership = (
            TenantMembership.objects.filter(tenant=tenant, user=user, is_active=True)
            .select_related("role")
            .first()
        )
        if membership is None or membership.role is None:
            return None
        return (membership.role.name or "").lower() or None

    def _get_blueprint_for(self, deal: Deal) -> Blueprint | None:
        """Return the active :class:`Blueprint` for ``deal``'s pipeline (or None)."""
        return (
            Blueprint.objects.filter(pipeline_id=deal.pipeline_id, is_active=True)
            .select_related("pipeline")
            .first()
        )

    def _get_execution(self, deal: Deal) -> BlueprintExecution | None:
        """Return the :class:`BlueprintExecution` for ``deal`` (or None)."""
        return BlueprintExecution.objects.filter(deal=deal).select_related(
            "current_state", "blueprint"
        ).first()

    # ------------------------------------------------------------------ conditions

    def evaluate_condition(self, deal: Deal, conditions: dict[str, Any]) -> tuple[bool, str]:
        """Evaluate a JSON field-expression blob against ``deal``.

        ``conditions`` maps a deal field name to a dict of operator →
        operand. Supported operators:

        * ``$gt`` / ``$lt`` / ``$gte`` / ``$lte`` — numeric comparison.
        * ``$eq`` / ``$ne`` — equality (string-coerced).
        * ``$in`` — membership in a list.
        * ``$exists`` — boolean; ``True`` requires the field to be
          non-empty, ``False`` requires it to be empty.

        Example::

            {
                "amount": {"$gt": 50000},
                "lead_source": {"$in": ["web", "referral"]},
                "account": {"$exists": True},
            }

        Returns ``(ok, reason)``. ``reason`` is a human-readable string
        (empty when ``ok`` is ``True``).
        """
        if not isinstance(conditions, dict) or not conditions:
            return True, ""

        for field_name, ops in conditions.items():
            if not isinstance(ops, dict):
                return False, f"Condition for '{field_name}' must be an object."
            field_value = _get_field(deal, field_name)
            for op, operand in ops.items():
                if op not in _SUPPORTED_OPERATORS:
                    return False, f"Unsupported operator '{op}' for field '{field_name}'."
                ok, why = self._eval_op(field_name, field_value, op, operand)
                if not ok:
                    return False, why
        return True, ""

    def _eval_op(
        self,
        field_name: str,
        field_value: Any,
        op: str,
        operand: Any,
    ) -> tuple[bool, str]:
        """Evaluate a single ``(field, op, operand)`` triple."""
        if op == "$exists":
            exists = field_value not in (None, "", [])
            want = bool(operand)
            if exists != want:
                return False, (
                    f"field '{field_name}' should "
                    f"{'exist' if want else 'be empty'} but does "
                    f"{'not' if not exists else ''}."
                ).strip()
            return True, ""

        if op == "$in":
            if not isinstance(operand, list):
                return False, f"$in operand for '{field_name}' must be a list."
            if field_value is None:
                return False, f"field '{field_name}' is empty (required by $in)."
            # Compare by string so int / Decimal / FK-id all match cleanly.
            str_field = str(field_value)
            str_operand = [str(o) for o in operand]
            if str_field not in str_operand:
                return False, f"field '{field_name}' value '{str_field}' not in {operand}."
            return True, ""

        # Equality / inequality — string-coerced comparison.
        if op in ("$eq", "$ne"):
            str_field = "" if field_value is None else str(field_value)
            str_operand = "" if operand is None else str(operand)
            equal = str_field == str_operand
            if op == "$eq" and not equal:
                return False, f"field '{field_name}' must equal {operand!r} (got {str_field!r})."
            if op == "$ne" and equal:
                return False, f"field '{field_name}' must not equal {operand!r}."
            return True, ""

        # Numeric comparisons ($gt / $lt / $gte / $lte).
        left = _coerce_decimal(field_value)
        right = _coerce_decimal(operand)
        if left is None or right is None:
            return False, (
                f"field '{field_name}' or operand {operand!r} is not numeric "
                f"(got {field_value!r})."
            )
        if op == "$gt" and not left > right:
            return False, f"field '{field_name}' ({left}) must be > {right}."
        if op == "$lt" and not left < right:
            return False, f"field '{field_name}' ({left}) must be < {right}."
        if op == "$gte" and not left >= right:
            return False, f"field '{field_name}' ({left}) must be >= {right}."
        if op == "$lte" and not left <= right:
            return False, f"field '{field_name}' ({left}) must be <= {right}."
        return True, ""

    # ------------------------------------------------------------------ require_fields

    def _check_require_fields(
        self,
        deal: Deal,
        transition: BlueprintTransition,
    ) -> list[str]:
        """Return the list of ``require_fields`` that are empty on ``deal``."""
        missing: list[str] = []
        for field_name in transition.require_fields or []:
            value = _get_field(deal, field_name)
            if value in (None, "", []):
                missing.append(field_name)
        return missing

    def _check_field_requirements(
        self,
        deal: Deal,
        transition: BlueprintTransition,
    ) -> list[str]:
        """Return human-readable failures for each :class:`BlueprintFieldRequirement` row."""
        failures: list[str] = []
        for req in transition.field_requirements.all():
            value = _get_field(deal, req.field_name)
            ok, why = self._eval_field_requirement(req, value)
            if not ok:
                failures.append(f"{req.field_name} {req.condition} {req.value or ''}: {why}")
        return failures

    def _eval_field_requirement(self, req: BlueprintFieldRequirement, value: Any) -> tuple[bool, str]:
        """Evaluate a single :class:`BlueprintFieldRequirement` against ``value``."""
        cond = req.condition
        target = req.value or ""

        if cond == CONDITION_NOT_EMPTY:
            if value in (None, "", []):
                return False, "field is empty"
            return True, ""

        if cond == CONDITION_EQUALS:
            str_value = "" if value is None else str(value)
            if str_value != target:
                return False, f"value '{str_value}' != '{target}'"
            return True, ""

        if cond == CONDITION_NOT_EQUALS:
            str_value = "" if value is None else str(value)
            if str_value == target:
                return False, f"value '{str_value}' == '{target}'"
            return True, ""

        if cond == CONDITION_IN:
            # ``target`` is a comma-separated list (stored in a TextField).
            allowed = [item.strip() for item in target.split(",") if item.strip()]
            str_value = "" if value is None else str(value)
            if str_value not in allowed:
                return False, f"value '{str_value}' not in {allowed}"
            return True, ""

        # Numeric comparisons.
        left = _coerce_decimal(value)
        right = _coerce_decimal(target)
        if left is None or right is None:
            return False, f"value {value!r} or target {target!r} is not numeric"
        if cond == CONDITION_GREATER_THAN and not left > right:
            return False, f"{left} not > {right}"
        if cond == CONDITION_LESS_THAN and not left < right:
            return False, f"{left} not < {right}"
        return True, ""

    # ------------------------------------------------------------------ validate_transition

    def validate_transition(
        self,
        deal: Deal,
        to_state: BlueprintState,
        user: "User",
    ) -> dict[str, Any]:
        """Validate a move of ``deal`` to ``to_state`` without executing it.

        Returns a structured result::

            {
                "valid": bool,
                "errors": list[str],
                "missing_fields": list[str],
                "requires_approval": bool,
            }

        Validation steps:

        1. The deal's pipeline has an active :class:`Blueprint`.
        2. The deal has a :class:`BlueprintExecution`.
        3. ``to_state`` belongs to the same blueprint as the execution's
           ``current_state``.
        4. A :class:`BlueprintTransition` row exists from the current
           state to ``to_state``.
        5. The actor's role is in ``transition.allowed_roles`` (empty =
           all roles).
        6. ``transition.conditions`` evaluates to OK against the deal.
        7. Every name in ``transition.require_fields`` is non-empty on
           the deal.
        8. Every :class:`BlueprintFieldRequirement` row on the transition
           passes.
        9. ``requires_approval`` is set when the transition has a
           ``require_approval`` FK.
        """
        result: dict[str, Any] = {
            "valid": False,
            "errors": [],
            "missing_fields": [],
            "requires_approval": False,
        }

        blueprint = self._get_blueprint_for(deal)
        if blueprint is None:
            result["errors"].append("Deal's pipeline has no active blueprint.")
            return result

        execution = self._get_execution(deal)
        if execution is None:
            result["errors"].append("Deal has no blueprint execution.")
            return result

        if execution.blueprint_id != blueprint.pk:
            result["errors"].append(
                "Deal's execution belongs to a different blueprint version."
            )
            return result

        if execution.current_state_id is None:
            result["errors"].append("Deal's execution has no current state.")
            return result

        if to_state.blueprint_id != blueprint.pk:
            result["errors"].append("Target state does not belong to the deal's blueprint.")
            return result

        transition = (
            BlueprintTransition.objects.select_related("require_approval")
            .filter(
                blueprint_id=blueprint.pk,
                from_state_id=execution.current_state_id,
                to_state_id=to_state.pk,
            )
            .first()
        )
        if transition is None:
            result["errors"].append(
                "No transition defined from the current state to the target state."
            )
            return result

        # Role check.
        if transition.allowed_roles:
            role_name = self._resolve_role_name(tenant=deal.tenant, user=user)
            allowed = {str(r).lower() for r in transition.allowed_roles}
            if role_name is None or role_name not in allowed:
                result["errors"].append(
                    f"Role '{role_name or 'none'}' is not permitted "
                    f"(allowed: {sorted(allowed)})."
                )

        # Conditions check.
        ok, why = self.evaluate_condition(deal, transition.conditions or {})
        if not ok:
            result["errors"].append(f"Conditions not met: {why}")

        # require_fields (simple list).
        missing = self._check_require_fields(deal, transition)
        if missing:
            result["missing_fields"].extend(missing)
            result["errors"].append(f"Required fields are empty: {missing}.")

        # Structured field requirements.
        failures = self._check_field_requirements(deal, transition)
        if failures:
            result["errors"].extend(failures)

        # Approval gate.
        if transition.require_approval_id is not None:
            result["requires_approval"] = True

        result["valid"] = not result["errors"]
        return result

    # ------------------------------------------------------------------ execute_transition

    @transaction.atomic
    def execute_transition(
        self,
        deal: Deal,
        to_state: BlueprintState,
        user: "User",
        *,
        reason: str = "",
    ) -> BlueprintExecution:
        """Validate + execute a transition atomically.

        On success:

        * The current state's ``exit_actions`` are run.
        * ``execution.current_state`` is updated, ``entered_state_at`` is
          stamped, and the history entry is appended.
        * The deal's ``stage`` + ``forecast_category`` are updated and
          saved (the deal is moved into the stage that backs
          ``to_state``).
        * A :class:`deals.models.DealStageHistory` row is appended.
        * The target state's ``entry_actions`` and the transition's
          ``post_transition_actions`` are run.
        * A ``deal.blueprint_transition`` activity is logged via
          :func:`crm_ux.services.log_activity`.
        * If ``transition.require_approval`` is set, an approval-request
          notification is dispatched (Phase-9 stub — the actual approval
          workflow ships in Phase 9; for now we create an
          ``approval_requested`` notification).

        Raises :class:`django.core.exceptions.ValidationError` on any
        validation failure.
        """
        validation = self.validate_transition(deal, to_state, user)
        if not validation["valid"]:
            raise ValidationError(validation["errors"])

        execution = self._get_execution(deal)
        assert execution is not None  # validate_transition guarantees this

        now = timezone.now()
        from_state = execution.current_state

        # Look up the transition (validated above).
        from_state_id = from_state.pk if from_state else None
        transition = (
            BlueprintTransition.objects.select_related(
                "require_approval", "from_state", "to_state"
            )
            .get(
                blueprint_id=execution.blueprint_id,
                from_state_id=from_state_id,
                to_state_id=to_state.pk,
            )
        )

        context = self._build_action_context(deal, user, transition)

        # 1. Run exit_actions on the current state.
        if from_state is not None and from_state.exit_actions:
            self.run_actions(from_state.exit_actions, deal, context)

        # 2. Update the deal's stage + forecast_category.
        old_stage = deal.stage
        new_stage = to_state.stage
        deal.stage = new_stage
        deal.forecast_category = new_stage.forecast_category
        if new_stage.is_won_stage:
            deal.probability = 100.0
        elif new_stage.is_lost_stage:
            deal.probability = 0.0
        deal.save(update_fields=["stage", "forecast_category", "probability", "updated_at"])

        # 3. Update the execution.
        prior_entered_at = execution.entered_state_at
        duration_seconds = int((now - prior_entered_at).total_seconds())
        execution.current_state = to_state
        execution.entered_state_at = now
        execution.append_history(
            from_state=from_state.pk if from_state else None,
            to_state=to_state.pk,
            changed_by=user,
            changed_at=now,
            reason=reason or "",
        )
        if to_state.state_type == STATE_TYPE_TERMINAL:
            execution.is_complete = True
        execution.save(
            update_fields=[
                "current_state",
                "entered_state_at",
                "history",
                "is_complete",
                "updated_at",
            ]
        )

        # 4. DealStageHistory audit row (mirrors PipelineService).
        DealStageHistory.objects.create(
            tenant=deal.tenant,
            deal=deal,
            from_stage=old_stage,
            to_stage=new_stage,
            changed_by=user,
            changed_at=now,
            reason=reason or "",
            duration_in_previous_stage=max(duration_seconds, 0),
        )

        # 5. Run entry_actions on the new state.
        if to_state.entry_actions:
            self.run_actions(to_state.entry_actions, deal, context)

        # 6. Run post_transition_actions on the transition.
        if transition.post_transition_actions:
            self.run_actions(transition.post_transition_actions, deal, context)

        # 7. Apply structured assignments.
        self._apply_assignments(transition, deal, user)

        # 8. Activity log.
        try:
            from crm_ux.services import log_activity

            log_activity(
                tenant=deal.tenant,
                user=user,
                module="deal",
                record_id=str(deal.pk),
                record_name=deal.name,
                action="deal.blueprint_transition",
                description=(
                    f"Blueprint moved '{deal.name}' from "
                    f"'{from_state.stage.name if from_state else '?'}' to "
                    f"'{to_state.stage.name}' ({duration_seconds}s in prior state)."
                ),
                metadata={
                    "blueprint_id": execution.blueprint_id,
                    "from_state_id": from_state.pk if from_state else None,
                    "to_state_id": to_state.pk,
                    "duration_seconds": duration_seconds,
                    "reason": reason or "",
                    "requires_approval": transition.require_approval_id is not None,
                },
            )
        except Exception:  # pragma: no cover — defensive: never break a transition
            log.exception("execute_transition: failed to log activity for deal %s", deal.pk)

        # 9. Approval gate — create an approval-request notification.
        if transition.require_approval_id is not None:
            self._dispatch_approval_request(transition, deal, user, reason or "")

        return execution

    # ------------------------------------------------------------------ get_available_transitions

    def get_available_transitions(
        self,
        deal: Deal,
        user: "User",
    ) -> list[dict[str, Any]]:
        """List every transition the deal *could* take from its current state.

        Each entry is::

            {
                "to_state": <BlueprintState dict>,
                "transition_id": int,
                "valid": bool,
                "blocked_reason": str | None,
                "missing_fields": list[str],
                "requires_approval": bool,
            }

        Stages flagged terminal on the source state (i.e. the deal's
        current state is terminal) return an empty list.
        """
        execution = self._get_execution(deal)
        if execution is None or execution.current_state_id is None:
            return []
        if execution.current_state.state_type == STATE_TYPE_TERMINAL:
            return []

        transitions = (
            BlueprintTransition.objects.filter(
                blueprint_id=execution.blueprint_id,
                from_state_id=execution.current_state_id,
            )
            .select_related("to_state__stage", "to_state__blueprint", "require_approval")
            .prefetch_related("field_requirements")
        )

        out: list[dict[str, Any]] = []
        for tr in transitions:
            validation = self.validate_transition(deal, tr.to_state, user)
            blocked_reason: str | None = None
            if not validation["valid"]:
                blocked_reason = "; ".join(validation["errors"])
            out.append(
                {
                    "to_state": self._serialize_state(tr.to_state),
                    "transition_id": tr.pk,
                    "valid": validation["valid"],
                    "blocked_reason": blocked_reason,
                    "missing_fields": validation["missing_fields"],
                    "requires_approval": validation["requires_approval"],
                }
            )
        return out

    # ------------------------------------------------------------------ enforce_on_create

    def enforce_on_create(self, deal: Deal) -> BlueprintExecution | None:
        """Auto-create a :class:`BlueprintExecution` for a freshly-created deal.

        Called by :mod:`blueprint.signals` on ``Deal.post_save(created=True)``.
        If the deal's pipeline has an active blueprint, an execution is
        created with ``current_state`` set to the blueprint state that
        maps to the deal's stage (or the first state if no match). The
        execution's ``entered_state_at`` is the deal's ``created_at``.

        Returns ``None`` when the pipeline has no active blueprint.
        """
        if BlueprintExecution.objects.filter(deal=deal).exists():
            return self._get_execution(deal)

        blueprint = self._get_blueprint_for(deal)
        if blueprint is None:
            return None

        # Find the state that maps to the deal's stage — or fall back to
        # the first state (lowest stage order) on the blueprint.
        state = (
            BlueprintState.objects.filter(blueprint=blueprint, stage_id=deal.stage_id).first()
        )
        if state is None:
            state = (
                BlueprintState.objects.filter(blueprint=blueprint)
                .select_related("stage")
                .order_by("stage__order", "id")
                .first()
            )
        if state is None:
            # Blueprint has no states yet — nothing to enforce.
            return None

        execution = BlueprintExecution.objects.create(
            tenant=deal.tenant,
            deal=deal,
            blueprint=blueprint,
            current_state=state,
            entered_state_at=deal.created_at or timezone.now(),
            history=[],
            is_complete=state.state_type == STATE_TYPE_TERMINAL,
        )

        # Best-effort activity log.
        try:
            from crm_ux.services import log_activity

            log_activity(
                tenant=deal.tenant,
                user=getattr(deal, "owner", None),
                module="deal",
                record_id=str(deal.pk),
                record_name=deal.name,
                action="deal.blueprint_created",
                description=(
                    f"Blueprint '{blueprint.name}' attached to '{deal.name}' "
                    f"(initial state: '{state.stage.name}')."
                ),
                metadata={
                    "blueprint_id": blueprint.pk,
                    "initial_state_id": state.pk,
                },
            )
        except Exception:  # pragma: no cover — defensive
            log.exception("enforce_on_create: failed to log activity for deal %s", deal.pk)

        return execution

    # ------------------------------------------------------------------ check_timers

    def check_timers(self) -> dict[str, Any]:
        """Hourly Celery beat — fire every due :class:`BlueprintTimer`.

        For each active :class:`BlueprintExecution` whose ``current_state``
        has any :class:`BlueprintTimer` rows, and for each timer whose
        ``hours`` have elapsed since ``entered_state_at``:

        * ``auto_transition`` — call :meth:`execute_transition` to
          ``target_state`` (actor = the deal's owner, or the system user
          when no owner).
        * ``notify`` — dispatch an in-app notification to every user in
          ``notify_roles`` (best-effort — skipped when no roles are
          configured or no user holds them).
        * ``escalate`` — dispatch an in-app notification to
          ``escalate_to`` (a role name or a user id).

        Returns a summary dict for the Celery log line.
        """
        from api.managers import tenant_context
        from api.models import Organization, User

        summary: dict[str, Any] = {
            "tenants_processed": 0,
            "timers_fired": 0,
            "auto_transitions": 0,
            "notifications_sent": 0,
            "errors": [],
        }

        for org in Organization.objects.filter(is_active=True).iterator(chunk_size=200):
            with tenant_context(org):
                summary["tenants_processed"] += 1
                executions = (
                    BlueprintExecution.objects.filter(
                        tenant=org,
                        is_complete=False,
                        current_state__isnull=False,
                    )
                    .select_related("current_state", "deal__owner", "blueprint")
                    .iterator(chunk_size=200)
                )
                now = timezone.now()
                for execution in executions:
                    timers = BlueprintTimer.objects.filter(
                        state_id=execution.current_state_id
                    ).select_related("target_state")
                    for timer in timers:
                        elapsed = now - execution.entered_state_at
                        if elapsed < timedelta(hours=timer.hours):
                            continue
                        summary["timers_fired"] += 1
                        try:
                            if timer.action == TIMER_ACTION_AUTO_TRANSITION:
                                if timer.target_state_id is None:
                                    summary["errors"].append(
                                        {
                                            "execution_id": execution.pk,
                                            "error": "auto_transition timer has no target_state",
                                        }
                                    )
                                    continue
                                actor = execution.deal.owner or self._system_user()
                                self.execute_transition(
                                    execution.deal,
                                    timer.target_state,
                                    actor,
                                    reason=f"Auto-transition after {timer.hours}h in state.",
                                )
                                summary["auto_transitions"] += 1
                            elif timer.action == TIMER_ACTION_NOTIFY:
                                sent = self._notify_roles(
                                    execution,
                                    timer.notify_roles or [],
                                    verb="task_due",
                                    title=(
                                        f"Deal '{execution.deal.name}' has been in "
                                        f"'{execution.current_state.stage.name}' "
                                        f"for {timer.hours}h"
                                    ),
                                    body=(
                                        "The deal has overstayed its blueprint state. "
                                        "Take action or it may auto-transition."
                                    ),
                                    extra={"timer_id": timer.pk, "alert_type": "blueprint_notify"},
                                )
                                summary["notifications_sent"] += sent
                            elif timer.action == TIMER_ACTION_ESCALATE:
                                sent = self._notify_escalate_to(
                                    execution,
                                    timer.escalate_to,
                                    verb="task_due",
                                    title=(
                                        f"Deal '{execution.deal.name}' escalated — "
                                        f"overstayed '{execution.current_state.stage.name}'"
                                    ),
                                    body=(
                                        f"Deal has been in state for >{timer.hours}h. "
                                        "Escalation triggered by the blueprint timer."
                                    ),
                                    extra={"timer_id": timer.pk, "alert_type": "blueprint_escalate"},
                                )
                                summary["notifications_sent"] += sent
                        except Exception as exc:  # pragma: no cover — defensive
                            log.exception(
                                "check_timers: failed for execution %s timer %s",
                                execution.pk, timer.pk,
                            )
                            summary["errors"].append(
                                {
                                    "execution_id": execution.pk,
                                    "timer_id": timer.pk,
                                    "error": str(exc),
                                }
                            )

        log.info(
            "check_timers: tenants=%s fired=%s auto=%s sent=%s",
            summary["tenants_processed"],
            summary["timers_fired"],
            summary["auto_transitions"],
            summary["notifications_sent"],
        )
        return summary

    # ------------------------------------------------------------------ compliance

    def get_compliance_report(self, pipeline: Pipeline) -> dict[str, Any]:
        """Return blueprint-adoption metrics for ``pipeline``.

        * ``total_deals`` — non-deleted deals in the pipeline.
        * ``in_blueprint`` — deals with a :class:`BlueprintExecution`
          whose blueprint belongs to the pipeline.
        * ``compliant_deals`` — same as ``in_blueprint`` (a deal with an
          execution is following the blueprint).
        * ``non_compliant_deals`` — deals without an execution.
        * ``compliance_rate`` — ``compliant / total`` (0..1).
        * ``stuck_deals`` — count of deals whose current state has
          exceeded its ``time_limit_hours``.
        """
        deals_qs = Deal.objects.filter(pipeline=pipeline, deleted_at__isnull=True)
        total = deals_qs.count()
        execution_deal_ids = set(
            BlueprintExecution.objects.filter(
                deal__pipeline=pipeline,
                deal__deleted_at__isnull=True,
                blueprint__pipeline=pipeline,
            ).values_list("deal_id", flat=True)
        )
        compliant = len(execution_deal_ids)
        non_compliant = max(total - compliant, 0)
        rate = (compliant / total) if total else 0.0
        stuck = self.get_stuck_deals(pipeline)
        return {
            "total_deals": total,
            "in_blueprint": compliant,
            "compliant_deals": compliant,
            "non_compliant_deals": non_compliant,
            "compliance_rate": round(rate, 4),
            "stuck_deals": len(stuck),
        }

    def get_stuck_deals(self, pipeline: Pipeline) -> list[dict[str, Any]]:
        """Return deals whose current blueprint state has exceeded ``time_limit_hours``.

        Each entry is a plain dict with ``deal_id``, ``deal_name``,
        ``state_id``, ``stage_name``, ``entered_state_at``,
        ``hours_in_state``, ``time_limit_hours``.
        """
        out: list[dict[str, Any]] = []
        now = timezone.now()
        executions = (
            BlueprintExecution.objects.filter(
                blueprint__pipeline=pipeline,
                deal__deleted_at__isnull=True,
                current_state__isnull=False,
                is_complete=False,
            )
            .exclude(current_state__time_limit_hours__isnull=True)
            .select_related("deal", "current_state__stage", "current_state__blueprint")
        )
        for ex in executions:
            limit = ex.current_state.time_limit_hours
            hours_in_state = (now - ex.entered_state_at).total_seconds() / 3600.0
            if hours_in_state <= limit:
                continue
            out.append(
                {
                    "deal_id": ex.deal_id,
                    "deal_name": ex.deal.name,
                    "execution_id": ex.pk,
                    "state_id": ex.current_state_id,
                    "stage_name": ex.current_state.stage.name,
                    "entered_state_at": ex.entered_state_at.isoformat(),
                    "hours_in_state": round(hours_in_state, 2),
                    "time_limit_hours": limit,
                }
            )
        return out

    # ------------------------------------------------------------------ run_actions

    def run_actions(
        self,
        actions: list[dict[str, Any]],
        deal: Deal,
        context: dict[str, Any],
    ) -> None:
        """Execute a list of action dicts against ``deal``.

        Each action is ``{"type": "...", "params": {...}}``. Supported
        types:

        * ``create_task`` — params: ``title``, ``description``,
          ``due_date`` (ISO 8601), ``assignee_id`` (optional),
          ``priority`` (optional, default ``medium``).
        * ``send_notification`` — params: ``verb``, ``title``, ``body``,
          ``recipient_id`` (optional — defaults to the deal owner),
          ``recipient_role`` (optional).
        * ``update_field`` — params: ``field_name``, ``value``.
        * ``assign_to`` — params: ``assign_to`` (``role`` | ``user`` |
          ``team`` | ``field_value``), ``assign_value``.

        Failures on individual actions are logged + swallowed so a
        misconfigured action never breaks the transition. The caller is
        expected to be inside ``transaction.atomic`` (the action list is
        best-effort and side-effectful — partial writes roll back with
        the caller's transaction).
        """
        if not isinstance(actions, list):
            return
        for action in actions:
            if not isinstance(action, dict):
                continue
            action_type = action.get("type")
            params = action.get("params") or {}
            try:
                if action_type == "create_task":
                    self._action_create_task(deal, context, params)
                elif action_type == "send_notification":
                    self._action_send_notification(deal, context, params)
                elif action_type == "update_field":
                    self._action_update_field(deal, context, params)
                elif action_type == "assign_to":
                    self._action_assign_to(deal, context, params)
                else:
                    log.warning("run_actions: unknown action type %r", action_type)
            except Exception:  # pragma: no cover — defensive
                log.exception("run_actions: action %r failed", action_type)

    def _action_create_task(self, deal: Deal, context: dict[str, Any], params: dict[str, Any]) -> None:
        from datetime import datetime

        from tasks.models import Task

        assignee_id = params.get("assignee_id") or deal.owner_id
        due = params.get("due_date")
        due_dt: datetime | None = None
        if due:
            try:
                due_dt = datetime.fromisoformat(due)
            except ValueError:
                due_dt = None
        Task.objects.create(
            tenant=deal.tenant,
            title=params.get("title") or f"Blueprint task for {deal.name}",
            description=params.get("description") or "",
            due_date=due_dt,
            assignee_id=assignee_id,
            owner_id=deal.owner_id,
            created_by=context.get("user"),
            related_module="deal",
            related_id=str(deal.pk),
            priority=params.get("priority", "medium"),
        )

    def _action_send_notification(self, deal: Deal, context: dict[str, Any], params: dict[str, Any]) -> None:
        from notifications.services import create_notification

        user = context.get("user")
        recipient_id = params.get("recipient_id")
        recipient_role = params.get("recipient_role")
        recipient = None
        if recipient_id:
            from api.models import User

            recipient = User.objects.filter(pk=recipient_id).first()
        if recipient is None and recipient_role:
            recipient = self._first_user_with_role(deal.tenant, recipient_role)
        if recipient is None:
            recipient = deal.owner
        if recipient is None:
            return
        create_notification(
            tenant=deal.tenant,
            actor=user,
            verb=params.get("verb", "updated"),
            target_module="deal",
            target_id=str(deal.pk),
            target_name=deal.name,
            recipient=recipient,
            data={
                "title": params.get("title", "Blueprint notification"),
                "body": params.get("body", ""),
                "deal_id": deal.pk,
                "blueprint_id": context.get("blueprint_id"),
            },
        )

    def _action_update_field(self, deal: Deal, context: dict[str, Any], params: dict[str, Any]) -> None:
        field_name = params.get("field_name")
        value = params.get("value")
        if not field_name:
            return
        # Only allow setting real model fields (avoid arbitrary attribute
        # writes).
        allowed = {f.name for f in deal._meta.get_fields()}
        if field_name not in allowed:
            log.warning("update_field: refusing to set unknown field %r", field_name)
            return
        setattr(deal, field_name, value)
        deal.save(update_fields=[field_name, "updated_at"])

    def _action_assign_to(self, deal: Deal, context: dict[str, Any], params: dict[str, Any]) -> None:
        """Best-effort assignment — sets ``deal.owner`` based on the rule."""
        assign_to = params.get("assign_to")
        assign_value = params.get("assign_value")
        if not assign_to or not assign_value:
            return
        user_id = self._resolve_assignee_id(deal, assign_to, assign_value)
        if user_id is not None:
            deal.owner_id = user_id
            deal.save(update_fields=["owner", "updated_at"])

    def _resolve_assignee_id(
        self,
        deal: Deal,
        assign_to: str,
        assign_value: str,
    ) -> int | None:
        """Resolve an assignment rule to a user id."""
        from api.models import TenantMembership, User

        if assign_to == "user":
            try:
                return int(assign_value)
            except (TypeError, ValueError):
                return None
        if assign_to == "role":
            membership = (
                TenantMembership.objects.filter(
                    tenant=deal.tenant,
                    is_active=True,
                    role__name__iexact=assign_value,
                )
                .select_related("user")
                .first()
            )
            return membership.user_id if membership else None
        if assign_to == "team":
            from api.models import Team

            team = Team.objects.filter(tenant=deal.tenant, pk=assign_value).first()
            if team is None or team.lead_id is None:
                return None
            return team.lead_id
        if assign_to == "field_value":
            value = getattr(deal, assign_value, None)
            if isinstance(value, User):
                return value.pk
            if isinstance(value, int):
                return value
        return None

    # ------------------------------------------------------------------ assignments

    def _apply_assignments(self, transition: BlueprintTransition, deal: Deal, user: "User") -> None:
        """Resolve every :class:`BlueprintAssignment` on the transition into an ``assign_to`` action."""
        for assignment in transition.assignments.all():
            try:
                self._action_assign_to(
                    deal,
                    {"blueprint_id": transition.blueprint_id, "user": user},
                    {
                        "assign_to": assignment.assign_to,
                        "assign_value": assignment.assign_value,
                    },
                )
            except Exception:  # pragma: no cover — defensive
                log.exception(
                    "_apply_assignments: failed for transition %s assignment %s",
                    transition.pk, assignment.pk,
                )

    # ------------------------------------------------------------------ approval

    def _dispatch_approval_request(
        self,
        transition: BlueprintTransition,
        deal: Deal,
        user: "User",
        reason: str,
    ) -> None:
        """Send an ``approval_requested`` notification to tenant admins.

        Phase 9 will replace this with the real approval workflow (per
        :class:`ApprovalProcess` approver list + criteria). For now we
        notify every tenant admin so the request isn't silently dropped.
        """
        from notifications.services import create_notification

        recipients = self._tenant_admins(deal.tenant)
        for recipient in recipients:
            try:
                create_notification(
                    tenant=deal.tenant,
                    actor=user,
                    verb="approval_requested",
                    target_module="deal",
                    target_id=str(deal.pk),
                    target_name=deal.name,
                    recipient=recipient,
                    data={
                        "title": f"Approval required: '{deal.name}' blueprint transition",
                        "body": (
                            f"Transition '{transition.from_state.stage.name}' → "
                            f"'{transition.to_state.stage.name}' on deal '{deal.name}' "
                            f"requires approval. Reason: {reason}".strip()
                        ),
                        "deal_id": deal.pk,
                        "transition_id": transition.pk,
                        "approval_process_id": transition.require_approval_id,
                    },
                )
            except Exception:  # pragma: no cover — defensive
                log.exception(
                    "_dispatch_approval_request: failed for recipient %s deal %s",
                    recipient.pk, deal.pk,
                )

    # ------------------------------------------------------------------ notification helpers

    def _first_user_with_role(self, tenant: "Organization", role_name: str) -> "User | None":
        from api.models import TenantMembership

        membership = (
            TenantMembership.objects.filter(
                tenant=tenant,
                is_active=True,
                role__name__iexact=role_name,
            )
            .select_related("user")
            .first()
        )
        return membership.user if membership else None

    def _notify_roles(
        self,
        execution: BlueprintExecution,
        role_names: list[str],
        *,
        verb: str,
        title: str,
        body: str,
        extra: dict[str, Any] | None = None,
    ) -> int:
        """Dispatch ``verb`` to every user in ``role_names`` for the execution's tenant."""
        if not role_names:
            return 0
        from api.models import TenantMembership

        recipients = (
            TenantMembership.objects.filter(
                tenant=execution.tenant,
                is_active=True,
                role__name__iexact__in=role_names,
            )
            .select_related("user")
        )
        sent = 0
        seen: set[int] = set()
        for membership in recipients:
            if membership.user_id in seen:
                continue
            seen.add(membership.user_id)
            sent += self._send(execution, membership.user, verb=verb, title=title, body=body, extra=extra)
        return sent

    def _notify_escalate_to(
        self,
        execution: BlueprintExecution,
        escalate_to: str,
        *,
        verb: str,
        title: str,
        body: str,
        extra: dict[str, Any] | None = None,
    ) -> int:
        """Dispatch ``verb`` to ``escalate_to`` (a role name or a user id)."""
        if not escalate_to:
            return 0
        recipient = None
        if escalate_to.isdigit():
            from api.models import User

            recipient = User.objects.filter(pk=int(escalate_to)).first()
        else:
            recipient = self._first_user_with_role(execution.tenant, escalate_to)
        if recipient is None:
            return 0
        return self._send(execution, recipient, verb=verb, title=title, body=body, extra=extra)

    def _send(
        self,
        execution: BlueprintExecution,
        recipient: "User",
        *,
        verb: str,
        title: str,
        body: str,
        extra: dict[str, Any] | None,
    ) -> int:
        from notifications.services import create_notification

        try:
            create_notification(
                tenant=execution.tenant,
                actor=None,
                verb=verb,
                target_module="deal",
                target_id=str(execution.deal_id),
                target_name=execution.deal.name,
                recipient=recipient,
                data={
                    "title": title,
                    "body": body,
                    "deal_id": execution.deal_id,
                    "execution_id": execution.pk,
                    **(extra or {}),
                },
            )
            return 1
        except Exception:  # pragma: no cover — defensive
            log.exception(
                "_send: failed to notify recipient %s for execution %s",
                recipient.pk, execution.pk,
            )
            return 0

    # ------------------------------------------------------------------ misc helpers

    def _tenant_admins(self, tenant: "Organization") -> list["User"]:
        from api.models import TenantMembership
        from api.permissions import is_admin_role

        memberships = (
            TenantMembership.objects.filter(tenant=tenant, is_active=True)
            .select_related("role", "user")
            .iterator(chunk_size=200)
        )
        out: list["User"] = []
        seen: set[int] = set()
        for m in memberships:
            if m.user_id in seen:
                continue
            if is_admin_role(m.role):
                out.append(m.user)
                seen.add(m.user_id)
        return out

    def _system_user(self) -> "User":
        """Return a system user (oldest superuser) for auto-transitions."""
        from api.models import User

        user = User.objects.filter(is_superuser=True).order_by("id").first()
        if user is not None:
            return user
        # Fall back to any user — only relevant in test environments.
        return User.objects.order_by("id").first()  # type: ignore[return-value]

    def _build_action_context(
        self,
        deal: Deal,
        user: "User",
        transition: BlueprintTransition,
    ) -> dict[str, Any]:
        """Build the shared context dict passed into ``run_actions``."""
        return {
            "user": user,
            "deal_id": deal.pk,
            "blueprint_id": transition.blueprint_id,
            "transition_id": transition.pk,
            "from_state_id": transition.from_state_id,
            "to_state_id": transition.to_state_id,
        }

    def _serialize_state(self, state: BlueprintState) -> dict[str, Any]:
        """Plain-dict representation of a :class:`BlueprintState` for the available-transitions payload."""
        return {
            "id": state.pk,
            "blueprint_id": state.blueprint_id,
            "stage_id": state.stage_id,
            "stage_name": state.stage.name if state.stage_id else "",
            "state_type": state.state_type,
            "time_limit_hours": state.time_limit_hours,
        }


__all__ = ["BlueprintService"]
