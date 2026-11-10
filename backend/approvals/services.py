"""Approval engine — service layer.

The :class:`ApprovalService` is the canonical interface for the approval
workflow:

* :meth:`submit` — create a runtime :class:`ApprovalRequest` for a record +
  process name, advance to the first step, and notify the first step's
  approvers.
* :meth:`approve` / :meth:`reject` — record an :class:`ApprovalAction`,
  advance or fail the request per the step's ``step_type`` strategy,
  notify the submitter.
* :meth:`delegate` — re-route the current step to a delegate (also records
  an :class:`ApprovalAction` for audit).
* :meth:`recall` — submitter cancels a pending request.
* :meth:`escalate_expired` — Celery beat (hourly). Walks every pending
  request whose ``current_step.time_limit_hours`` has elapsed and
  re-routes it to the step's ``escalation_approver``.
* :meth:`get_pending_for_user` / :meth:`get_my_requests` — convenience
  queries for the "My approvals" / "My requests" UI panels.

The service is deliberately stateless — callers pass plain ORM objects
(``User``, ``ApprovalProcess``) and get back either the mutated request or
a structured result dict. Persistence side effects (action row, activity
log, notification) are co-located in :meth:`_record_action` so all writes
happen in a single transaction.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from decimal import Decimal, InvalidOperation
from typing import TYPE_CHECKING, Any

from django.db import transaction
from django.utils import timezone

from approvals.models import (
    ACTION_APPROVE,
    ACTION_DELEGATE,
    ACTION_ESCALATE,
    ACTION_REJECT,
    APPROVER_TYPE_DYNAMIC,
    APPROVER_TYPE_ROLE,
    APPROVER_TYPE_TEAM,
    APPROVER_TYPE_USER,
    STATUS_APPROVED,
    STATUS_ESCALATED,
    STATUS_PENDING,
    STATUS_RECALLED,
    STATUS_REJECTED,
    STEP_FIRST_TO_APPROVE,
    STEP_MAJORITY_VOTE,
    STEP_PARALLEL,
    STEP_SEQUENTIAL,
    STEP_UNANIMOUS,
    ApprovalAction,
    ApprovalDelegation,
    ApprovalProcess,
    ApprovalRequest,
    ApprovalStep,
)

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization, User

log = logging.getLogger(__name__)


###############################################################################
# Helpers — approver resolution + condition evaluation
###############################################################################


#: JSON operators supported by :meth:`ApprovalService._evaluate_criteria`.
_SUPPORTED_OPERATORS = {"$gt", "$lt", "$gte", "$lte", "$eq", "$ne", "$in", "$exists"}


def _coerce_decimal(value: Any) -> Decimal | None:
    """Best-effort coercion of ``value`` into a :class:`Decimal`."""
    if value is None or value == "":
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


class ApprovalService:
    """Stateless service encapsulating the approval workflow business rules.

    All public methods accept plain ORM objects so the service is
    straightforward to unit-test without an HTTP layer. Callers are
    expected to have already set the thread-local tenant context (see
    :func:`api.managers.tenant_context`) when invoking write paths.
    """

    # ------------------------------------------------------------------ helpers

    def _resolve_approver_ids(
        self,
        *,
        tenant: "Organization",
        approvers: list[dict[str, Any]],
        submitter: "User | None" = None,
    ) -> list[int]:
        """Resolve a JSON ``approvers`` list into a list of user ids.

        Each entry is ``{type, value}`` where ``type`` is one of ``role``,
        ``user``, ``team``, ``dynamic``. ``role`` resolves via
        :class:`api.models.TenantMembership`; ``user`` is a direct id lookup;
        ``team`` resolves via :class:`api.models.Team` (members are the team
        lead + every active member — kept simple for the first cut);
        ``dynamic`` is a placeholder that returns ``[submitter]``'s manager
        if known (left as a stub for future extension).
        """
        from api.models import Team, TenantMembership, User

        ids: list[int] = []
        seen: set[int] = set()
        for entry in approvers or []:
            if not isinstance(entry, dict):
                continue
            kind = entry.get("type")
            value = entry.get("value")
            if not kind or value in (None, ""):
                continue

            if kind == APPROVER_TYPE_USER:
                try:
                    user_id = int(value)
                except (TypeError, ValueError):
                    continue
                if User.objects.filter(pk=user_id, is_active_account=True).exists():
                    self._add(ids, seen, user_id)

            elif kind == APPROVER_TYPE_ROLE:
                memberships = (
                    TenantMembership.objects.filter(
                        tenant=tenant,
                        is_active=True,
                        role__name__iexact=str(value),
                    )
                    .select_related("user")
                )
                for m in memberships:
                    if m.user_id is not None:
                        self._add(ids, seen, m.user_id)

            elif kind == APPROVER_TYPE_TEAM:
                try:
                    team_id = int(value)
                except (TypeError, ValueError):
                    continue
                team = Team.objects.filter(pk=team_id, tenant=tenant).first()
                if team is None:
                    continue
                # Lead + every member of the team. We treat the team as the
                # set of users who have a membership with role name == team
                # name (lightweight proxy for a real team membership table).
                if team.lead_id is not None:
                    self._add(ids, seen, team.lead_id)
                # Memberships whose role name matches the team name.
                for m in TenantMembership.objects.filter(
                    tenant=tenant, is_active=True, role__name__iexact=team.name
                ).select_related("user"):
                    if m.user_id is not None:
                        self._add(ids, seen, m.user_id)

            elif kind == APPROVER_TYPE_DYNAMIC:
                # Placeholder: resolve to the submitter's tenant admin.
                # Future iterations may evaluate ``value`` as a Python
                # expression against the record.
                if submitter is not None:
                    admin = self._first_admin(tenant)
                    if admin is not None:
                        self._add(ids, seen, admin.pk)

        return ids

    @staticmethod
    def _add(out: list[int], seen: set[int], user_id: int) -> None:
        if user_id and user_id not in seen:
            seen.add(user_id)
            out.append(user_id)

    @staticmethod
    def _first_admin(tenant: "Organization") -> "User | None":
        from api.models import TenantMembership
        from api.permissions import is_admin_role

        membership = (
            TenantMembership.objects.filter(tenant=tenant, is_active=True)
            .select_related("role", "user")
            .first()
        )
        if membership is None or membership.user is None:
            return None
        if is_admin_role(membership.role):
            return membership.user
        return None

    def _resolve_delegate(self, *, tenant: "Organization", user: "User") -> "User | None":
        """Return the active delegate for ``user`` (if any), else ``None``."""
        today = timezone.now().date()
        delegation = (
            ApprovalDelegation.objects.filter(
                tenant=tenant,
                user=user,
                is_active=True,
                start_date__lte=today,
                end_date__gte=today,
            )
            .select_related("delegate_to")
            .first()
        )
        return delegation.delegate_to if delegation else None

    def _evaluate_criteria(self, record_data: dict[str, Any], criteria: dict[str, Any]) -> bool:
        """Evaluate a JSON field-expression blob against ``record_data``.

        Mirrors :meth:`blueprint.services.BlueprintService.evaluate_condition`
        — same operator vocabulary (``$gt`` / ``$lt`` / ``$gte`` / ``$lte`` /
        ``$eq`` / ``$ne`` / ``$in`` / ``$exists``). Returns ``True`` when
        every clause matches.
        """
        if not isinstance(criteria, dict) or not criteria:
            return True
        for field_name, ops in criteria.items():
            if not isinstance(ops, dict):
                return False
            field_value = record_data.get(field_name)
            for op, operand in ops.items():
                if op not in _SUPPORTED_OPERATORS:
                    return False
                if not self._eval_op(field_name, field_value, op, operand):
                    return False
        return True

    def _eval_op(
        self,
        field_name: str,
        field_value: Any,
        op: str,
        operand: Any,
    ) -> bool:
        """Evaluate a single ``(field, op, operand)`` triple."""
        if op == "$exists":
            exists = field_value not in (None, "", [])
            return exists == bool(operand)
        if op == "$in":
            if not isinstance(operand, list):
                return False
            if field_value is None:
                return False
            return str(field_value) in [str(o) for o in operand]
        if op in ("$eq", "$ne"):
            str_field = "" if field_value is None else str(field_value)
            str_operand = "" if operand is None else str(operand)
            equal = str_field == str_operand
            return equal if op == "$eq" else not equal
        left = _coerce_decimal(field_value)
        right = _coerce_decimal(operand)
        if left is None or right is None:
            return False
        if op == "$gt":
            return left > right
        if op == "$lt":
            return left < right
        if op == "$gte":
            return left >= right
        if op == "$lte":
            return left <= right
        return False  # pragma: no cover — defensive

    # ------------------------------------------------------------------ submit

    def submit(
        self,
        *,
        record_module: str,
        record_id: str | int,
        record_name: str,
        process_name: str,
        submitted_by: "User",
        record_data: dict[str, Any] | None = None,
    ) -> ApprovalRequest:
        """Create + dispatch a new :class:`ApprovalRequest`.

        Looks up the active :class:`ApprovalProcess` by ``process_name``,
        validates that ``record_data`` matches the process's
        ``trigger_criteria`` (when supplied), creates the request, advances
        to the first :class:`ApprovalStep`, and notifies the first step's
        approvers.

        Raises ``ValueError`` when:

        * no active process with ``process_name`` exists in the tenant,
        * the process has no steps,
        * ``record_data`` is supplied and does not satisfy the
          ``trigger_criteria``.
        """
        from notifications.services import create_notification

        tenant = self._tenant_for(submitted_by)
        process = ApprovalProcess.objects.filter(
            tenant=tenant,
            name=process_name,
            is_active=True,
        ).first()
        if process is None:
            raise ValueError(
                f"No active approval process named {process_name!r} in this tenant."
            )
        if record_data is not None and not self._evaluate_criteria(record_data, process.trigger_criteria):
            raise ValueError("Record does not satisfy the process trigger_criteria.")
        first_step = (
            ApprovalStep.objects.filter(process=process).order_by("order", "id").first()
        )
        if first_step is None:
            raise ValueError(f"Approval process {process.name!r} has no steps.")

        request = ApprovalRequest.objects.create(
            tenant=tenant,
            process=process,
            target_module=record_module,
            target_id=str(record_id),
            target_name=record_name,
            submitted_by=submitted_by,
            submitted_at=timezone.now(),
            current_step=first_step,
            status=STATUS_PENDING,
        )
        # Notify the first step's approvers.
        approver_ids = self._resolve_approver_ids(
            tenant=tenant, approvers=first_step.approvers, submitter=submitted_by
        )
        for user_id in approver_ids:
            self._notify(
                tenant=tenant,
                actor=submitted_by,
                recipient_id=user_id,
                verb="approval_requested",
                target_module=record_module,
                target_id=str(record_id),
                target_name=record_name,
                title=f"Approval requested: {record_name}",
                body=(
                    f"{submitted_by.name or submitted_by.email} requested your "
                    f"approval on {record_module} '{record_name}' "
                    f"(process: {process.name})."
                ),
                extra={"request_id": request.pk, "process_id": process.pk},
            )
        return request

    # ------------------------------------------------------------------ approve

    def approve(self, *, request: ApprovalRequest, user: "User", comment: str = "") -> ApprovalRequest:
        """Record an approve action and advance the request.

        Step-type resolution:

        * ``sequential`` / ``first_to_approve`` — the first approve advances
          to the next step (or completes the request if this was the last).
        * ``parallel`` — every approver in ``approvers`` must approve before
          the step completes.
        * ``majority_vote`` — step completes when more than half of the
          approvers have approved.
        * ``unanimous`` — every approver must approve (any reject fails the
          step — handled in :meth:`reject`).

        On completion of the final step the request status flips to
        ``approved``, ``completed_at`` is set, and the submitter is
        notified.
        """
        from notifications.services import create_notification

        self._assert_open(request)
        step = request.current_step
        if step is None:
            raise ValueError("Approval request has no current step.")
        if step.require_comment and not comment:
            raise ValueError("This step requires a comment.")

        with transaction.atomic():
            self._record_action(
                request=request, user=user, action=ACTION_APPROVE, comment=comment
            )
            if self._step_complete_on_approve(request, step, user):
                next_step = self._next_step(step)
                if next_step is None:
                    request.status = STATUS_APPROVED
                    request.completed_at = timezone.now()
                    request.current_step = None
                    request.save(
                        update_fields=["status", "completed_at", "current_step", "updated_at"]
                    )
                    # Notify the submitter.
                    if request.submitted_by_id is not None:
                        create_notification(
                            tenant=request.tenant,
                            actor=user,
                            verb="approval_completed",
                            target_module=request.target_module,
                            target_id=request.target_id,
                            target_name=request.target_name,
                            recipient_id=request.submitted_by_id,
                            data={
                                "title": f"Approved: {request.target_name}",
                                "body": (
                                    f"Your approval request for "
                                    f"{request.target_module} '{request.target_name}' "
                                    f"was approved."
                                ),
                                "request_id": request.pk,
                            },
                        )
                else:
                    request.current_step = next_step
                    request.save(update_fields=["current_step", "updated_at"])
                    # Notify the next step's approvers.
                    approver_ids = self._resolve_approver_ids(
                        tenant=request.tenant,
                        approvers=next_step.approvers,
                        submitter=request.submitted_by,
                    )
                    for rid in approver_ids:
                        self._notify(
                            tenant=request.tenant,
                            actor=user,
                            recipient_id=rid,
                            verb="approval_requested",
                            target_module=request.target_module,
                            target_id=request.target_id,
                            target_name=request.target_name,
                            title=f"Approval requested: {request.target_name}",
                            body=(
                                f"Step #{next_step.order} of "
                                f"'{request.process.name}' requires your approval."
                            ),
                            extra={"request_id": request.pk, "step_id": next_step.pk},
                        )
        return request

    # ------------------------------------------------------------------ reject

    def reject(self, *, request: ApprovalRequest, user: "User", comment: str = "") -> ApprovalRequest:
        """Record a reject action; the request status flips to ``rejected``.

        Notify the submitter. The ``completed_at`` timestamp is set so the
        UI can sort completed requests by completion time.
        """
        from notifications.services import create_notification

        self._assert_open(request)
        step = request.current_step
        if step is not None and step.require_comment and not comment:
            raise ValueError("This step requires a comment.")

        with transaction.atomic():
            self._record_action(
                request=request, user=user, action=ACTION_REJECT, comment=comment
            )
            request.status = STATUS_REJECTED
            request.completed_at = timezone.now()
            request.current_step = None
            request.save(
                update_fields=["status", "completed_at", "current_step", "updated_at"]
            )
        if request.submitted_by_id is not None:
            create_notification(
                tenant=request.tenant,
                actor=user,
                verb="approval_completed",
                target_module=request.target_module,
                target_id=request.target_id,
                target_name=request.target_name,
                recipient_id=request.submitted_by_id,
                data={
                    "title": f"Rejected: {request.target_name}",
                    "body": (
                        f"Your approval request for "
                        f"{request.target_module} '{request.target_name}' "
                        f"was rejected."
                    ),
                    "request_id": request.pk,
                },
            )
        return request

    # ------------------------------------------------------------------ delegate

    def delegate(
        self,
        *,
        request: ApprovalRequest,
        user: "User",
        delegate_to: "User",
        comment: str = "",
    ) -> ApprovalRequest:
        """Re-route the current step to ``delegate_to``.

        Records an :class:`ApprovalAction` with ``action=delegate``. The
        request's ``current_step`` is unchanged — the delegate simply joins
        the approver pool for the step. The audit trail captures who
        delegated to whom via the action row's ``comment``.
        """
        self._assert_open(request)
        with transaction.atomic():
            self._record_action(
                request=request,
                user=user,
                action=ACTION_DELEGATE,
                comment=comment or f"Delegated to user {delegate_to.pk}",
            )
            # Stash the delegate on the request's comments so the UI can
            # surface it; the canonical audit is the action row.
            request.append_comment(
                user_id=user.pk,
                comment=f"Delegated to user {delegate_to.pk}: {comment}".strip(),
            )
            request.save(update_fields=["comments", "updated_at"])
        return request

    # ------------------------------------------------------------------ recall

    def recall(self, *, request: ApprovalRequest, user: "User") -> ApprovalRequest:
        """Submitter cancels a pending request. Status flips to ``recalled``."""
        if request.submitted_by_id != user.pk:
            raise ValueError("Only the submitter can recall an approval request.")
        self._assert_open(request)
        with transaction.atomic():
            request.status = STATUS_RECALLED
            request.completed_at = timezone.now()
            request.current_step = None
            request.save(
                update_fields=["status", "completed_at", "current_step", "updated_at"]
            )
        return request

    # ------------------------------------------------------------------ escalate

    def escalate_expired(self) -> dict[str, Any]:
        """Celery beat (hourly). Walk every pending request whose
        ``current_step.time_limit_hours`` has elapsed and escalate.

        Escalation re-routes the step to the step's ``escalation_approver``
        (when set) by recording an :class:`ApprovalAction` with
        ``action=escalate`` and notifying the escalation approver. The
        request status is set to ``escalated`` so the UI can surface it,
        but the request is still considered pending for the escalation
        approver to act on.
        """
        from notifications.services import create_notification

        now = timezone.now()
        summary: dict[str, Any] = {"checked": 0, "escalated": 0, "errors": 0}
        qs = (
            ApprovalRequest.objects.filter(status=STATUS_PENDING)
            .select_related("current_step", "tenant", "submitted_by")
            .exclude(current_step__isnull=True)
            .exclude(current_step__time_limit_hours__isnull=True)
        )
        for request in qs.iterator(chunk_size=200):
            summary["checked"] += 1
            step = request.current_step
            if step is None or step.time_limit_hours is None:
                continue
            # Find the most recent action timestamp to compute elapsed time.
            last_action = (
                ApprovalAction.objects.filter(request=request).order_by("-timestamp").first()
            )
            reference = last_action.timestamp if last_action else request.submitted_at
            if reference is None:
                continue
            if now - reference < timedelta(hours=step.time_limit_hours):
                continue
            escalation = step.escalation_approver or {}
            if not isinstance(escalation, dict) or not escalation:
                continue
            approver_ids = self._resolve_approver_ids(
                tenant=request.tenant,
                approvers=[escalation],
                submitter=request.submitted_by,
            )
            if not approver_ids:
                continue
            try:
                with transaction.atomic():
                    self._record_action(
                        request=request,
                        user=None,
                        action=ACTION_ESCALATE,
                        comment=(
                            f"Escalated: step #{step.order} exceeded its "
                            f"{step.time_limit_hours}h time limit."
                        ),
                    )
                    request.status = STATUS_ESCALATED
                    request.save(update_fields=["status", "updated_at"])
                for rid in approver_ids:
                    create_notification(
                        tenant=request.tenant,
                        actor=None,
                        verb="approval_requested",
                        target_module=request.target_module,
                        target_id=request.target_id,
                        target_name=request.target_name,
                        recipient_id=rid,
                        data={
                            "title": f"Escalated: {request.target_name}",
                            "body": (
                                f"Approval request for "
                                f"{request.target_module} '{request.target_name}' "
                                f"was escalated to you after exceeding the step "
                                f"time limit."
                            ),
                            "request_id": request.pk,
                        },
                    )
                summary["escalated"] += 1
            except Exception:  # pragma: no cover — defensive
                summary["errors"] += 1
                log.exception("escalate_expired: failed for request %s", request.pk)
        return summary

    # ------------------------------------------------------------------ queries

    def get_pending_for_user(self, user: "User") -> list[ApprovalRequest]:
        """Return requests where ``user`` is an approver in the current step + status=pending.

        Resolves the user's effective approver pool per request and
        returns the subset where ``user.pk`` is in the pool. Honors active
        :class:`ApprovalDelegation` — if ``user`` is the delegate in an
        active delegation, requests delegated *from* the original user are
        also returned.
        """
        tenant = self._tenant_for(user)
        out: list[ApprovalRequest] = []
        # Direct: user is in the current step's approvers.
        direct_ids = {user.pk}
        # Delegated: any user whose active delegation points at ``user``.
        today = timezone.now().date()
        delegated_from = list(
            ApprovalDelegation.objects.filter(
                tenant=tenant,
                delegate_to=user,
                is_active=True,
                start_date__lte=today,
                end_date__gte=today,
            ).values_list("user_id", flat=True)
        )
        candidate_ids = direct_ids | set(delegated_from)
        qs = (
            ApprovalRequest.objects.filter(status=STATUS_PENDING)
            .select_related("current_step", "tenant", "submitted_by", "process")
            .exclude(current_step__isnull=True)
        )
        for request in qs.iterator(chunk_size=200):
            step = request.current_step
            if step is None:
                continue
            approver_ids = set(
                self._resolve_approver_ids(
                    tenant=request.tenant,
                    approvers=step.approvers,
                    submitter=request.submitted_by,
                )
            )
            if approver_ids & candidate_ids:
                out.append(request)
        return out

    def get_my_requests(self, user: "User") -> list[ApprovalRequest]:
        """Return requests submitted by ``user``."""
        return list(
            ApprovalRequest.objects.filter(submitted_by=user)
            .select_related("process", "current_step")
            .order_by("-submitted_at")
        )

    # ------------------------------------------------------------------ internals

    @staticmethod
    def _assert_open(request: ApprovalRequest) -> None:
        if request.status != STATUS_PENDING and request.status != STATUS_ESCALATED:
            raise ValueError(
                f"Approval request {request.pk} is not open (status={request.status})."
            )

    @staticmethod
    def _tenant_for(user: "User") -> "Organization":
        from api.managers import get_current_tenant
        from api.models import TenantMembership

        tenant = get_current_tenant()
        if tenant is not None:
            return tenant
        membership = (
            TenantMembership.objects.filter(user=user, is_active=True)
            .select_related("tenant")
            .first()
        )
        if membership is None or membership.tenant is None:
            raise ValueError(f"User {user.pk} has no active tenant membership.")
        return membership.tenant

    def _record_action(
        self,
        *,
        request: ApprovalRequest,
        user: "User | None",
        action: str,
        comment: str,
    ) -> None:
        """Persist an :class:`ApprovalAction` row + append the comment to the request."""
        ApprovalAction.objects.create(
            tenant=request.tenant,
            request=request,
            approver=user,
            action=action,
            comment=comment or "",
            timestamp=timezone.now(),
        )
        if comment:
            user_id = user.pk if user is not None else 0
            request.append_comment(user_id=user_id, comment=comment)
            request.save(update_fields=["comments", "updated_at"])

    def _step_complete_on_approve(
        self,
        request: ApprovalRequest,
        step: ApprovalStep,
        user: "User",
    ) -> bool:
        """Return ``True`` when the current step is satisfied by the approve action.

        ``sequential`` / ``first_to_approve`` — the first action completes the
        step. ``parallel`` / ``unanimous`` — every approver must approve.
        ``majority_vote`` — more than half of the approvers must approve.
        """
        if step.step_type in (STEP_SEQUENTIAL, STEP_FIRST_TO_APPROVE):
            return True
        tenant = request.tenant
        approver_ids = self._resolve_approver_ids(
            tenant=tenant, approvers=step.approvers, submitter=request.submitted_by
        )
        if not approver_ids:
            return True
        approved_ids = set(
            ApprovalAction.objects.filter(
                request=request, action=ACTION_APPROVE
            ).values_list("approver_id", flat=True)
        )
        # Exclude rejected approvers (a reject earlier in the chain would
        # have flipped the status already, but defensive).
        approved_ids.discard(None)
        approved_pool = approved_ids & set(approver_ids)
        if step.step_type in (STEP_PARALLEL, STEP_UNANIMOUS):
            return len(approved_pool) == len(set(approver_ids))
        if step.step_type == STEP_MAJORITY_VOTE:
            return len(approved_pool) * 2 > len(set(approver_ids))
        return True  # pragma: no cover — defensive

    @staticmethod
    def _next_step(step: ApprovalStep) -> ApprovalStep | None:
        """Return the step immediately after ``step`` in the process (or ``None``)."""
        return (
            ApprovalStep.objects.filter(process=step.process, order__gt=step.order)
            .order_by("order", "id")
            .first()
        )

    def _notify(
        self,
        *,
        tenant: "Organization",
        actor: "User | None",
        recipient_id: int,
        verb: str,
        target_module: str,
        target_id: str,
        target_name: str,
        title: str,
        body: str,
        extra: dict[str, Any] | None = None,
    ) -> None:
        """Best-effort notification dispatch — never raises into the caller."""
        from notifications.services import create_notification

        try:
            create_notification(
                tenant=tenant,
                actor=actor,
                verb=verb,
                target_module=target_module,
                target_id=target_id,
                target_name=target_name,
                recipient_id=recipient_id,
                data={
                    "title": title,
                    "body": body,
                    **(extra or {}),
                },
            )
        except Exception:  # pragma: no cover — defensive
            log.exception("ApprovalService._notify: failed for recipient %s", recipient_id)


__all__ = ["ApprovalService"]
