"""Pipeline engine — service layer for the deals app (Phase 8).

The :class:`PipelineService` is the canonical interface for:

* **Transitioning** a deal between stages (:meth:`transition_deal`,
  :meth:`get_available_transitions`). Both validate the transition against
  the :class:`deals.models.StageTransition` graph, the actor's role, and the
  JSON ``conditions`` on the edge.
* **Stage-limit alerts** (:meth:`check_stage_limits`) — used by the daily
  Celery task in :mod:`deals.alerts` to surface deals stuck in a stage past
  its ``business_days_limit``.
* **Pipeline analytics** — :meth:`get_pipeline_metrics`,
  :meth:`get_deal_velocity`, :meth:`get_stage_conversion_rates`,
  :meth:`get_win_rate_by_stage`, :meth:`get_monthly_trend`. These power the
  pipeline dashboard and forecasting views.

The service is deliberately stateless — callers pass the deal (and the actor)
and get back either the mutated deal or a structured result dict. Persistence
side effects (history row, activity log, notification) are co-located in
:meth:`transition_deal` so all writes happen in a single transaction.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import timedelta
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Avg, Count, Q, QuerySet, Sum
from django.utils import timezone

from deals.models import Deal, DealStageHistory, StageTransition
from deals.models_pipeline import (
    Pipeline,
    Stage,
)

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization, User

log = logging.getLogger(__name__)


###############################################################################
# Helpers
###############################################################################


def _resolve_role_name(*, tenant: "Organization", user: "User") -> str | None:
    """Return the (lowercased) name of the user's role in ``tenant``.

    Returns ``None`` if the user has no active membership. Used by the
    transition guard to check membership of ``StageTransition.allowed_roles``.
    """
    from api.models import TenantMembership

    membership = (
        TenantMembership.objects.filter(tenant=tenant, user=user, is_active=True)
        .select_related("role")
        .first()
    )
    if membership is None or membership.role is None:
        return None
    return (membership.role.name or "").lower() or None


def _evaluate_conditions(*, deal: Deal, conditions: dict[str, Any]) -> tuple[bool, str]:
    """Evaluate a ``StageTransition.conditions`` blob against ``deal``.

    Returns ``(ok, reason)``. ``reason`` is a human-readable explanation
    suitable for surfacing in the API response when ``ok`` is ``False``.

    Supported keys (see :class:`deals.models.StageTransition` docstring):

    * ``min_amount`` / ``max_amount`` — inclusive Decimal range.
    * ``min_probability`` / ``max_probability`` — inclusive float range.
    * ``require_account`` — bool; deal must have ``account`` set.
    * ``require_close_date`` — bool; deal must have ``close_date`` set.
    """
    if not isinstance(conditions, dict) or not conditions:
        return True, ""

    amount = deal.amount or Decimal("0")
    probability = float(deal.probability or 0.0)

    min_amount = conditions.get("min_amount")
    if min_amount is not None and amount < Decimal(str(min_amount)):
        return False, f"amount {amount} below min_amount {min_amount}"

    max_amount = conditions.get("max_amount")
    if max_amount is not None and amount > Decimal(str(max_amount)):
        return False, f"amount {amount} above max_amount {max_amount}"

    min_prob = conditions.get("min_probability")
    if min_prob is not None and probability < float(min_prob):
        return False, f"probability {probability} below min_probability {min_prob}"

    max_prob = conditions.get("max_probability")
    if max_prob is not None and probability > float(max_prob):
        return False, f"probability {probability} above max_probability {max_prob}"

    if conditions.get("require_account") and not deal.account_id:
        return False, "deal has no account set (require_account=True)"

    if conditions.get("require_close_date") and not deal.close_date:
        return False, "deal has no close_date set (require_close_date=True)"

    return True, ""


def _last_entry_for_deal(deal: Deal) -> DealStageHistory | None:
    """Return the most recent :class:`DealStageHistory` for ``deal`` (or None)."""
    return (
        DealStageHistory.objects.filter(deal=deal)
        .order_by("-changed_at", "-id")
        .first()
    )


def _entered_at(deal: Deal) -> Any:
    """Return the datetime the deal entered its current stage.

    Falls back to ``deal.created_at`` when there is no prior history row
    (i.e. the deal has been in its initial stage since creation).
    """
    last = _last_entry_for_deal(deal)
    if last is not None:
        return last.changed_at
    return deal.created_at


###############################################################################
# Result dataclasses (for structured returns)
###############################################################################


@dataclass
class StageLimitReport:
    """Structured result of :meth:`PipelineService.check_stage_limits`."""

    stuck: bool
    days_in_stage: int
    limit: int | None
    alert: bool
    entered_at: Any = None  # datetime | None
    stage_id: int | None = None
    stage_name: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "stuck": self.stuck,
            "days_in_stage": self.days_in_stage,
            "limit": self.limit,
            "alert": self.alert,
            "entered_at": self.entered_at.isoformat() if self.entered_at else None,
            "stage_id": self.stage_id,
            "stage_name": self.stage_name,
        }


@dataclass
class TransitionResult:
    """Structured result of :meth:`PipelineService.transition_deal`."""

    deal: Deal
    history: DealStageHistory
    approval_required: bool = False
    duration_in_previous_stage: int = 0
    extra: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "deal_id": self.deal.pk,
            "stage_id": self.deal.stage_id,
            "forecast_category": self.deal.forecast_category,
            "history_id": self.history.pk,
            "approval_required": self.approval_required,
            "duration_in_previous_stage": self.duration_in_previous_stage,
        }


###############################################################################
# Service
###############################################################################


class PipelineService:
    """Stateless service encapsulating the pipeline engine business rules.

    All public methods accept plain ORM objects (``Deal``, ``Pipeline``,
    ``Stage``, ``User``) so the service is straightforward to unit-test
    without an HTTP layer. Callers are expected to have already set the
    thread-local tenant context (see :func:`api.managers.tenant_context`)
    when invoking write paths.
    """

    # ------------------------------------------------------------------ transitions

    @transaction.atomic
    def transition_deal(
        self,
        deal: Deal,
        to_stage: Stage,
        user: "User",
        *,
        reason: str = "",
    ) -> TransitionResult:
        """Move ``deal`` to ``to_stage`` after validating the transition.

        Validation:

        1. ``to_stage`` must belong to ``deal.pipeline``.
        2. ``deal.stage`` must not be ``is_locked`` (won/lost stages lock
           the deal by default; admins can override by setting
           ``is_locked=False`` on the closed stage).
        3. A :class:`StageTransition` row must exist for
           ``(pipeline, from_stage, to_stage)``.
        4. The actor's role must be in ``transition.allowed_roles`` (empty
           list = all roles).
        5. ``transition.conditions`` must evaluate to OK.

        On success:

        * ``deal.stage`` and ``deal.forecast_category`` are updated and
          saved (only ``stage`` / ``forecast_category`` / ``probability`` /
          ``updated_at`` are written — other pending field changes on the
          instance are preserved in memory but not persisted).
        * For terminal stages, ``probability`` is forced to 100 (won) / 0
          (lost); for non-terminal stages the deal's probability is left
          untouched (the caller may override it explicitly beforehand).
        * A :class:`DealStageHistory` row is appended with
          ``duration_in_previous_stage`` computed from the prior history
          entry (or ``deal.created_at``).
        * A ``deal.stage_changed`` activity is logged via
          :func:`crm_ux.services.log_activity`.
        * If the transition carries ``require_approval``, the result is
          flagged ``approval_required=True`` (Phase 9 will block here).

        Raises :class:`django.core.exceptions.ValidationError` on any
        validation failure. The caller (DRF view) maps that to HTTP 422.
        """
        if deal.pipeline_id != to_stage.pipeline_id:
            raise ValidationError(
                {"to_stage": "Target stage does not belong to the deal's pipeline."}
            )

        if deal.stage_id == to_stage.pk:
            raise ValidationError({"to_stage": "Deal is already in this stage."})

        if deal.stage_id and deal.stage.is_locked:
            raise ValidationError(
                {"stage": f"Stage '{deal.stage.name}' is locked — deals cannot leave it."}
            )

        transition = (
            StageTransition.objects.select_related("require_approval")
            .filter(
                pipeline_id=deal.pipeline_id,
                from_stage_id=deal.stage_id,
                to_stage_id=to_stage.pk,
            )
            .first()
        )
        if transition is None:
            raise ValidationError(
                {"to_stage": "No transition defined from the current stage to the target."}
            )

        # Role check — empty list means all roles.
        if transition.allowed_roles:
            role_name = _resolve_role_name(tenant=deal.tenant, user=user)
            allowed = {str(r).lower() for r in transition.allowed_roles}
            if role_name is None or role_name not in allowed:
                raise ValidationError(
                    {
                        "role": (
                            f"Role '{role_name or 'none'}' is not permitted to take "
                            f"this transition (allowed: {sorted(allowed)})."
                        )
                    }
                )

        # Conditions check.
        ok, why = _evaluate_conditions(deal=deal, conditions=transition.conditions or {})
        if not ok:
            raise ValidationError({"conditions": why})

        # ----- All checks passed; persist the transition. -----
        now = timezone.now()
        prior_entry = _last_entry_for_deal(deal)
        if prior_entry is not None:
            duration_seconds = int((now - prior_entry.changed_at).total_seconds())
        else:
            duration_seconds = int((now - deal.created_at).total_seconds())

        from_stage = deal.stage
        old_forecast = deal.forecast_category
        deal.stage = to_stage
        deal.forecast_category = to_stage.forecast_category
        if to_stage.is_won_stage:
            deal.probability = 100.0
        elif to_stage.is_lost_stage:
            deal.probability = 0.0
        deal.save(update_fields=["stage", "forecast_category", "probability", "updated_at"])

        history = DealStageHistory.objects.create(
            tenant=deal.tenant,
            deal=deal,
            from_stage=from_stage,
            to_stage=to_stage,
            changed_by=user,
            changed_at=now,
            reason=reason or "",
            duration_in_previous_stage=max(duration_seconds, 0),
        )

        # Best-effort activity log (CRM UX layer).
        try:
            from crm_ux.services import log_activity

            log_activity(
                tenant=deal.tenant,
                user=user,
                module="deal",
                record_id=str(deal.pk),
                record_name=deal.name,
                action="deal.stage_changed",
                description=(
                    f"Moved '{deal.name}' from '{from_stage.name}' to "
                    f"'{to_stage.name}' ({duration_seconds}s in prior stage)."
                ),
                metadata={
                    "from_stage_id": from_stage.pk if from_stage else None,
                    "to_stage_id": to_stage.pk,
                    "from_forecast_category": old_forecast,
                    "to_forecast_category": to_stage.forecast_category,
                    "duration_seconds": duration_seconds,
                    "reason": reason or "",
                },
            )
        except Exception:  # pragma: no cover — defensive: never break a transition
            log.exception("transition_deal: failed to log activity for deal %s", deal.pk)

        approval_required = transition.require_approval_id is not None

        return TransitionResult(
            deal=deal,
            history=history,
            approval_required=approval_required,
            duration_in_previous_stage=max(duration_seconds, 0),
        )

    def get_available_transitions(self, deal: Deal, user: "User") -> list[Stage]:
        """Return the list of :class:`Stage` objects the deal can move to.

        Filters the deal's pipeline transitions by:

        * the deal's current stage (``from_stage = deal.stage``);
        * the user's role (when ``allowed_roles`` is set);
        * the ``conditions`` blob (deals that fail the condition are hidden
          from the available list so the UI doesn't offer them).

        Stages flagged ``is_locked`` on the *source* (i.e. the deal's
        current stage) return an empty list — the deal cannot leave a
        locked stage via the standard transition path.
        """
        if deal.stage_id is None:
            return []
        if deal.stage.is_locked:
            return []

        transitions = StageTransition.objects.filter(
            pipeline_id=deal.pipeline_id,
            from_stage_id=deal.stage_id,
        ).select_related("to_stage")
        role_name = _resolve_role_name(tenant=deal.tenant, user=user)
        out: list[Stage] = []
        seen: set[int] = set()
        for tr in transitions:
            if tr.allowed_roles:
                allowed = {str(r).lower() for r in tr.allowed_roles}
                if role_name is None or role_name not in allowed:
                    continue
            ok, _ = _evaluate_conditions(deal=deal, conditions=tr.conditions or {})
            if not ok:
                continue
            if tr.to_stage_id in seen:
                continue
            seen.add(tr.to_stage_id)
            out.append(tr.to_stage)
        return out

    # ------------------------------------------------------------------ stage limits

    def check_stage_limits(self, deal: Deal) -> StageLimitReport:
        """Inspect whether ``deal`` has overstayed its current stage.

        Returns a :class:`StageLimitReport`. ``stuck`` is ``True`` when the
        deal has been in its current stage longer than ``limit`` business
        days. ``alert`` flips to ``True`` at 80 % of the limit so the UI
        can surface a warning *before* the limit is hit.
        """
        stage = deal.stage
        limit = getattr(stage, "business_days_limit", None)
        if not limit:
            return StageLimitReport(
                stuck=False,
                days_in_stage=0,
                limit=None,
                alert=False,
                entered_at=None,
                stage_id=stage.pk if stage else None,
                stage_name=getattr(stage, "name", "") if stage else "",
            )

        entered = _entered_at(deal)
        days_in_stage = self._business_days_between(entered, timezone.now())
        alert_threshold = max(limit * 0.8, 1)
        return StageLimitReport(
            stuck=days_in_stage > limit,
            days_in_stage=days_in_stage,
            limit=limit,
            alert=days_in_stage >= alert_threshold,
            entered_at=entered,
            stage_id=stage.pk,
            stage_name=stage.name,
        )

    @staticmethod
    def _business_days_between(start: Any, end: Any) -> int:
        """Count Mon–Fri days in the half-open ``[start, end]`` window.

        Falls back to a calendar-day count when ``start`` is ``None`` so the
        method never raises on a deal with no history.
        """
        if start is None or end is None:
            return 0
        if end < start:
            return 0
        # Strip tz for the arithmetic; restore is unnecessary for a count.
        cur = start
        count = 0
        while cur.date() < end.date():
            if cur.weekday() < 5:  # 0=Mon … 4=Fri
                count += 1
            cur = cur + timedelta(days=1)
        # Same-day window — count one business day if it's a weekday and
        # the deal has been there for at least an hour.
        if cur.date() == end.date() and cur.weekday() < 5:
            if (end - start).total_seconds() >= 3600:
                count += 1
        return count

    # ------------------------------------------------------------------ metrics

    def _base_deals_qs(
        self,
        pipeline: Pipeline,
        filters: dict[str, Any] | None = None,
    ) -> QuerySet[Deal]:
        """Tenant-scoped, non-deleted deals in ``pipeline`` + optional filters."""
        qs = Deal.objects.filter(pipeline=pipeline, deleted_at__isnull=True)
        if not filters:
            return qs
        if "owner_id" in filters:
            qs = qs.filter(owner_id=filters["owner_id"])
        if "owner_in" in filters:
            qs = qs.filter(owner_id__in=filters["owner_in"])
        if "stage_in" in filters:
            qs = qs.filter(stage_id__in=filters["stage_in"])
        if "forecast_category" in filters:
            qs = qs.filter(forecast_category=filters["forecast_category"])
        if "close_date_gte" in filters:
            qs = qs.filter(close_date__gte=filters["close_date_gte"])
        if "close_date_lte" in filters:
            qs = qs.filter(close_date__lte=filters["close_date_lte"])
        if "amount_gte" in filters:
            qs = qs.filter(amount__gte=filters["amount_gte"])
        if "amount_lte" in filters:
            qs = qs.filter(amount__lte=filters["amount_lte"])
        if "is_open" in filters:
            qs = qs.filter(is_open=filters["is_open"])
        return qs

    def get_pipeline_metrics(
        self,
        pipeline: Pipeline,
        filters: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Return per-stage + overall pipeline metrics.

        Per-stage row:

        * ``stage_id`` / ``stage_name`` / ``forecast_category``
        * ``count`` — open deals currently in the stage
        * ``sum_amount`` — sum of those deals' amounts (string to preserve
          Decimal precision)
        * ``weighted_value`` — ``sum(amount * probability / 100)``
        * ``avg_time_in_stage`` — average seconds deals spent in this stage
          (computed from completed :class:`DealStageHistory` exits)
        * ``conversion_rate`` — ``exited / entered`` (0..1); ``exited`` is
          the count of history rows with ``from_stage`` = this stage,
          ``entered`` is the count with ``to_stage`` = this stage.

        Overall:

        * ``total_count`` / ``total_amount`` / ``total_weighted``
        * ``win_rate`` — ``won / (won + lost)`` over the look-back window
          (all-time when no ``filters`` are provided).
        """
        stages = list(Stage.objects.filter(pipeline=pipeline).order_by("order", "id"))
        deals_qs = self._base_deals_qs(pipeline, filters)

        # Avg time in stage — from DealStageHistory exits.
        avg_time_qs = (
            DealStageHistory.objects.filter(from_stage__pipeline=pipeline)
            .values("from_stage_id")
            .annotate(avg_seconds=Avg("duration_in_previous_stage"))
        )
        avg_time_map: dict[int, float] = {
            row["from_stage_id"]: float(row["avg_seconds"] or 0) for row in avg_time_qs
        }

        # Conversion: entered vs exited per stage.
        entered_qs = (
            DealStageHistory.objects.filter(to_stage__pipeline=pipeline)
            .values("to_stage_id")
            .annotate(c=Count("id"))
        )
        exited_qs = (
            DealStageHistory.objects.filter(from_stage__pipeline=pipeline)
            .values("from_stage_id")
            .annotate(c=Count("id"))
        )
        entered_map: dict[int, int] = {row["to_stage_id"]: row["c"] for row in entered_qs}
        exited_map: dict[int, int] = {row["from_stage_id"]: row["c"] for row in exited_qs}

        per_stage: list[dict[str, Any]] = []
        total_count = 0
        total_amount = Decimal("0")
        total_weighted = Decimal("0")

        # Cache current deals per stage for the count / amount / weighted loop.
        # The weighted sum is computed in Python rather than via a SQL
        # expression so the query is portable across SQLite (tests) and
        # Postgres (prod) without conditional-aggregate gymnastics.
        deals_by_stage: dict[int, list[Deal]] = defaultdict(list)
        for d in deals_qs.select_related("stage"):
            deals_by_stage[d.stage_id].append(d)

        for stage in stages:
            deals_in_stage = deals_by_stage.get(stage.pk, [])
            count = len(deals_in_stage)
            sum_amount = sum((d.amount for d in deals_in_stage), Decimal("0"))
            weighted = Decimal("0")
            for d in deals_in_stage:
                weighted += Decimal(str(d.amount or 0)) * Decimal(
                    str(d.probability or 0)
                ) / Decimal("100")
            entered = entered_map.get(stage.pk, 0)
            exited = exited_map.get(stage.pk, 0)
            conversion_rate = (exited / entered) if entered else 0.0
            per_stage.append(
                {
                    "stage_id": stage.pk,
                    "stage_name": stage.name,
                    "forecast_category": stage.forecast_category,
                    "is_won_stage": stage.is_won_stage,
                    "is_lost_stage": stage.is_lost_stage,
                    "order": stage.order,
                    "count": count,
                    "sum_amount": str(sum_amount),
                    "weighted_value": str(weighted),
                    "avg_time_in_stage": avg_time_map.get(stage.pk, 0.0),
                    "conversion_rate": round(conversion_rate, 4),
                    "entered": entered,
                    "exited": exited,
                }
            )
            total_count += count
            total_amount += sum_amount
            total_weighted += weighted

        # Overall win rate — count deals currently in won vs lost stages.
        won_stages = {s.pk for s in stages if s.is_won_stage}
        lost_stages = {s.pk for s in stages if s.is_lost_stage}
        won_count = deals_qs.filter(stage_id__in=won_stages).count()
        lost_count = deals_qs.filter(stage_id__in=lost_stages).count()
        win_rate = (won_count / (won_count + lost_count)) if (won_count + lost_count) else 0.0

        return {
            "pipeline_id": pipeline.pk,
            "pipeline_name": pipeline.name,
            "stages": per_stage,
            "totals": {
                "total_count": total_count,
                "total_amount": str(total_amount),
                "total_weighted": str(total_weighted),
                "won_count": won_count,
                "lost_count": lost_count,
                "win_rate": round(win_rate, 4),
            },
        }

    # ------------------------------------------------------------------ velocity

    def get_deal_velocity(self, pipeline: Pipeline) -> list[dict[str, Any]]:
        """Return the average time-in-stage for every stage in ``pipeline``.

        Returns one row per stage ordered by ``order``:

        * ``stage_id`` / ``stage_name`` / ``order``
        * ``avg_seconds`` — mean ``duration_in_previous_stage`` from
          :class:`DealStageHistory` exits
        * ``exited_count`` — number of deals that left the stage
        * ``still_here_count`` — number of deals currently in the stage

        Stages with no exits (``exited_count = 0``) report ``avg_seconds = 0``
        so the bar chart renders an empty bar instead of crashing.
        """
        stages = list(Stage.objects.filter(pipeline=pipeline).order_by("order", "id"))
        avg_qs = (
            DealStageHistory.objects.filter(from_stage__pipeline=pipeline)
            .values("from_stage_id")
            .annotate(
                avg_seconds=Avg("duration_in_previous_stage"),
                exited_count=Count("id"),
            )
        )
        avg_map: dict[int, dict[str, Any]] = {
            row["from_stage_id"]: row for row in avg_qs
        }
        here_qs = (
            Deal.objects.filter(pipeline=pipeline, deleted_at__isnull=True)
            .values("stage_id")
            .annotate(c=Count("id"))
        )
        here_map: dict[int, int] = {row["stage_id"]: row["c"] for row in here_qs}

        out: list[dict[str, Any]] = []
        for stage in stages:
            row = avg_map.get(stage.pk, {})
            out.append(
                {
                    "stage_id": stage.pk,
                    "stage_name": stage.name,
                    "order": stage.order,
                    "avg_seconds": float(row.get("avg_seconds") or 0),
                    "exited_count": int(row.get("exited_count") or 0),
                    "still_here_count": here_map.get(stage.pk, 0),
                }
            )
        return out

    # ------------------------------------------------------------------ conversion

    def get_stage_conversion_rates(self, pipeline: Pipeline) -> list[dict[str, Any]]:
        """For each stage, the share of deals that moved on vs got lost.

        For every stage in ``pipeline`` (ordered by ``order``):

        * ``total_entered`` — number of :class:`DealStageHistory` rows with
          ``to_stage`` = this stage (i.e. deals that *ever* entered it).
        * ``moved_forward`` — number of history rows with ``from_stage`` =
          this stage whose ``to_stage`` is not a lost stage (i.e. deals
          that moved on, including to won).
        * ``lost`` — number of history rows with ``from_stage`` = this
          stage whose ``to_stage`` *is* a lost stage.
        * ``conversion_rate`` — ``moved_forward / (moved_forward + lost)``.

        Stages with no exits report 0 across the board. The output is
        designed to feed a funnel-style bar chart where each stage's bar
        represents the share of deals that survived it.
        """
        stages = list(Stage.objects.filter(pipeline=pipeline).order_by("order", "id"))
        lost_stage_ids = {s.pk for s in stages if s.is_lost_stage}

        entered_qs = (
            DealStageHistory.objects.filter(to_stage__pipeline=pipeline)
            .values("to_stage_id")
            .annotate(c=Count("id"))
        )
        entered_map: dict[int, int] = {row["to_stage_id"]: row["c"] for row in entered_qs}

        exits_qs = (
            DealStageHistory.objects.filter(from_stage__pipeline=pipeline)
            .values("from_stage_id", "to_stage_id")
            .annotate(c=Count("id"))
        )
        forward_map: dict[int, int] = defaultdict(int)
        lost_map: dict[int, int] = defaultdict(int)
        for row in exits_qs:
            if row["to_stage_id"] in lost_stage_ids:
                lost_map[row["from_stage_id"]] += row["c"]
            else:
                forward_map[row["from_stage_id"]] += row["c"]

        out: list[dict[str, Any]] = []
        for stage in stages:
            forward = forward_map.get(stage.pk, 0)
            lost = lost_map.get(stage.pk, 0)
            denom = forward + lost
            rate = (forward / denom) if denom else 0.0
            out.append(
                {
                    "stage_id": stage.pk,
                    "stage_name": stage.name,
                    "order": stage.order,
                    "total_entered": entered_map.get(stage.pk, 0),
                    "moved_forward": forward,
                    "lost": lost,
                    "conversion_rate": round(rate, 4),
                }
            )
        return out

    # ------------------------------------------------------------------ win-rate-by-stage

    def get_win_rate_by_stage(self, pipeline: Pipeline) -> list[dict[str, Any]]:
        """Where deals die: per-stage loss rates.

        For every stage in ``pipeline``, count the deals whose *terminal*
        transition was ``stage → lost_stage``. The output is sorted by
        ``lost_count`` desc so the dashboard can highlight the leakiest
        stage at the top.

        Each row:

        * ``stage_id`` / ``stage_name``
        * ``lost_count`` — deals whose last move from this stage was to a
          lost stage
        * ``total_exited`` — total deals that left this stage for any
          terminal stage (won or lost)
        * ``loss_rate`` — ``lost_count / total_exited`` (0..1)
        """
        stages = list(Stage.objects.filter(pipeline=pipeline))
        won_stage_ids = {s.pk for s in stages if s.is_won_stage}
        lost_stage_ids = {s.pk for s in stages if s.is_lost_stage}

        exits_qs = (
            DealStageHistory.objects.filter(from_stage__pipeline=pipeline)
            .values("from_stage_id", "to_stage_id")
            .annotate(c=Count("id"))
        )
        lost_map: dict[int, int] = defaultdict(int)
        won_map: dict[int, int] = defaultdict(int)
        for row in exits_qs:
            if row["to_stage_id"] in lost_stage_ids:
                lost_map[row["from_stage_id"]] += row["c"]
            elif row["to_stage_id"] in won_stage_ids:
                won_map[row["from_stage_id"]] += row["c"]

        out: list[dict[str, Any]] = []
        for stage in stages:
            lost = lost_map.get(stage.pk, 0)
            won = won_map.get(stage.pk, 0)
            total_exited = lost + won
            loss_rate = (lost / total_exited) if total_exited else 0.0
            out.append(
                {
                    "stage_id": stage.pk,
                    "stage_name": stage.name,
                    "lost_count": lost,
                    "won_count": won,
                    "total_exited": total_exited,
                    "loss_rate": round(loss_rate, 4),
                }
            )
        # Sort by lost_count desc, then by stage name for stable output.
        out.sort(key=lambda r: (-r["lost_count"], r["stage_name"]))
        return out

    # ------------------------------------------------------------------ monthly trend

    def get_monthly_trend(self, pipeline: Pipeline, months: int = 6) -> list[dict[str, Any]]:
        """Return count + amount per month for the last N months.

        Uses Django's :func:`~django.db.models.functions.TruncMonth` to
        bucket deals by ``created_at``. Each row:

        * ``month`` — ``YYYY-MM`` string (UTC)
        * ``count`` — deals created in the month
        * ``sum_amount`` — total ``amount`` (string)
        * ``won_count`` / ``won_amount`` — deals that ended up in a won
          stage (by the *current* snapshot, not by close_date — this is
          a forecasting view, not a closed-business ledger)
        * ``lost_count`` — deals currently in a lost stage

        Returns at least ``months`` rows; months with no deals are
        back-filled with zeros so the chart x-axis is continuous.
        """
        from django.db.models.functions import TruncMonth

        if months < 1:
            months = 1
        now = timezone.now()
        start = (now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)) - timedelta(
            days=31 * (months - 1)
        )
        # Snap to first-of-month.
        start = start.replace(day=1)

        stages = list(Stage.objects.filter(pipeline=pipeline))
        won_stage_ids = {s.pk for s in stages if s.is_won_stage}
        lost_stage_ids = {s.pk for s in stages if s.is_lost_stage}

        qs = Deal.objects.filter(
            pipeline=pipeline,
            deleted_at__isnull=True,
            created_at__gte=start,
        )
        rows = (
            qs.annotate(month=TruncMonth("created_at"))
            .values("month")
            .annotate(
                count=Count("id"),
                sum_amount=Sum("amount"),
                won_count=Count("id", filter=Q(stage_id__in=won_stage_ids)),
                lost_count=Count("id", filter=Q(stage_id__in=lost_stage_ids)),
            )
            .order_by("month")
        )
        by_month: dict[str, dict[str, Any]] = {}
        for row in rows:
            month_key = row["month"].strftime("%Y-%m") if row["month"] else "?"
            by_month[month_key] = {
                "month": month_key,
                "count": row["count"],
                "sum_amount": str(row["sum_amount"] or Decimal("0")),
                "won_count": row["won_count"],
                "won_amount": "0",
                "lost_count": row["lost_count"],
            }

        # Compute won_amount separately (Sum with filter is supported on
        # Postgres but the conditional-aggregate Sum with DecimalField is
        # awkward to express cleanly across SQLite/Postgres, so we sum in
        # Python for the much smaller won-deal set).
        won_deals = (
            qs.filter(stage_id__in=won_stage_ids)
            .annotate(month=TruncMonth("created_at"))
            .values("month")
            .annotate(won_amount=Sum("amount"))
        )
        for row in won_deals:
            month_key = row["month"].strftime("%Y-%m") if row["month"] else "?"
            if month_key in by_month:
                by_month[month_key]["won_amount"] = str(row["won_amount"] or Decimal("0"))

        # Backfill zero-months.
        out: list[dict[str, Any]] = []
        cur = start
        for _ in range(months):
            key = cur.strftime("%Y-%m")
            row = by_month.get(key)
            if row is None:
                row = {
                    "month": key,
                    "count": 0,
                    "sum_amount": "0",
                    "won_count": 0,
                    "won_amount": "0",
                    "lost_count": 0,
                }
            out.append(row)
            # Advance to the first of the next month.
            year = cur.year + (1 if cur.month == 12 else 0)
            month = (cur.month % 12) + 1
            cur = cur.replace(year=year, month=month, day=1)
        return out

    # ------------------------------------------------------------------ at-risk

    def get_at_risk_deals(
        self,
        pipeline: Pipeline | None = None,
        *,
        tenant: "Organization | None" = None,
    ) -> list[dict[str, Any]]:
        """Return deals that are stuck OR overdue.

        Used by the ``/api/v1/deals/at_risk/`` action. A deal is at-risk
        when either:

        * its current stage has a ``business_days_limit`` and the deal
          has exceeded it (``check_stage_limits().stuck``); or
        * its ``close_date`` is in the past and it's still in an open
          stage.

        The result is a list of plain dicts (one per deal) so the view can
        serialize directly without re-fetching.
        """
        qs = Deal.objects.filter(deleted_at__isnull=True)
        if pipeline is not None:
            qs = qs.filter(pipeline=pipeline)
        if tenant is not None:
            qs = qs.filter(tenant=tenant)
        qs = qs.select_related("stage", "pipeline", "owner")

        today = timezone.now().date()
        out: list[dict[str, Any]] = []
        for deal in qs.iterator(chunk_size=200):
            reasons: list[str] = []
            limit_report = self.check_stage_limits(deal)
            if limit_report.stuck:
                reasons.append(
                    f"stuck in stage '{deal.stage.name}' "
                    f"({limit_report.days_in_stage}d / limit {limit_report.limit}d)"
                )
            if deal.close_date and deal.close_date < today and deal.is_open:
                reasons.append(
                    f"close_date {deal.close_date.isoformat()} passed while still open"
                )
            if reasons:
                out.append(
                    {
                        "deal_id": deal.pk,
                        "deal_name": deal.name,
                        "pipeline_id": deal.pipeline_id,
                        "pipeline_name": deal.pipeline.name,
                        "stage_id": deal.stage_id,
                        "stage_name": deal.stage.name,
                        "owner_id": deal.owner_id,
                        "owner_email": deal.owner.email if deal.owner else None,
                        "amount": str(deal.amount or Decimal("0")),
                        "currency": deal.currency,
                        "close_date": deal.close_date.isoformat() if deal.close_date else None,
                        "forecast_category": deal.forecast_category,
                        "reasons": reasons,
                        "days_in_stage": limit_report.days_in_stage,
                        "stage_limit": limit_report.limit,
                    }
                )
        return out


###############################################################################
# Module-level helpers (kept tiny to avoid circular imports)
###############################################################################


__all__ = [
    "PipelineService",
    "StageLimitReport",
    "TransitionResult",
]
