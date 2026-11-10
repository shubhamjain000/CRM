"""Service layer for the goals app.

Five public functions:

* :func:`calculate_actual` — query CRM data for the goal's (metric,
  period, owner) and return the actual amount achieved.
* :func:`refresh_all_goals` — Celery-beat daily. Recalculate
  ``actual_amount`` on every active :class:`Goal`.
* :func:`get_leaderboard` — rank users by ``actual_amount`` for a given
  metric + period.
* :func:`check_achievements` — award gamification badges.
* :func:`get_goal_progress` — return ``{target, actual, percentage,
  status}`` for a user × metric × period.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from django.db.models import Sum
from django.utils import timezone

from .models import (
    BADGE_100_CALLS_WEEK,
    BADGE_100K_DEALS,
    BADGE_FIRST_DEAL,
    BADGE_TOP_PERFORMER_MONTH,
    Goal,
    GoalAchievement,
    METRIC_CALLS_MADE,
    METRIC_DEALS_CLOSED,
    METRIC_EMAILS_SENT,
    METRIC_LEADS_CREATED,
    METRIC_MEETINGS_HELD,
    METRIC_REVENUE,
    OWNER_ORG,
    OWNER_USER,
    PERIOD_DAILY,
    PERIOD_MONTHLY,
    PERIOD_QUARTERLY,
    PERIOD_WEEKLY,
    PERIOD_YEARLY,
)

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization, User

log = logging.getLogger(__name__)


###############################################################################
# Period helpers
###############################################################################


def period_bounds(
    period_type: str, ref: date | None = None
) -> tuple[date, date]:
    """Return ``(period_start, period_end)`` for the given period.

    Defaults to ``ref=date.today()``. ``period_end`` is inclusive. Week
    starts on Monday.
    """
    today = ref or date.today()
    if period_type == PERIOD_DAILY:
        return today, today
    if period_type == PERIOD_WEEKLY:
        start = today - timedelta(days=today.weekday())
        return start, start + timedelta(days=6)
    if period_type == PERIOD_MONTHLY:
        start = today.replace(day=1)
        next_month = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
        return start, next_month - timedelta(days=1)
    if period_type == PERIOD_QUARTERLY:
        q = (today.month - 1) // 3
        start = today.replace(month=q * 3 + 1, day=1)
        if q == 3:
            end = start.replace(month=12, day=31)
        else:
            end = start.replace(month=q * 3 + 4, day=1) - timedelta(days=1)
        return start, end
    if period_type == PERIOD_YEARLY:
        start = today.replace(month=1, day=1)
        return start, start.replace(month=12, day=31)
    raise ValueError(f"Unknown period_type: {period_type!r}")


###############################################################################
# calculate_actual
###############################################################################


def calculate_actual(goal: Goal) -> Decimal:
    """Return the actual amount achieved for ``goal``'s (metric, period, owner).

    Queries the appropriate CRM model (Deal / Lead / Call / Event /
    Email) filtered by the goal's period window and owner scope. Returns
    ``Decimal(0)`` for unsupported metrics / empty sets.

    Different models use different fields for the owning user — Deal /
    Lead / Account have ``owner``; Call has ``created_by``; Event has
    ``organizer``; Email has ``account.user``. Each metric block picks
    the right field.
    """
    start, end = goal.period_start, goal.period_end
    metric = goal.metric
    is_org = goal.owner_type == OWNER_ORG
    owner_id = goal.owner_id

    if metric == METRIC_REVENUE:
        from deals.models import Deal  # noqa: PLC0415
        from deals.models_pipeline import Stage  # noqa: PLC0415

        won_stages = Stage.objects.filter(is_won_stage=True)
        qs = Deal.objects.filter(
            close_date__gte=start, close_date__lte=end, stage__in=won_stages,
        )
        if is_org:
            qs = qs.filter(tenant=goal.tenant)
        else:
            qs = qs.filter(owner_id=owner_id)
        agg = qs.aggregate(total=Sum("amount"))
        return agg["total"] or Decimal(0)

    if metric == METRIC_DEALS_CLOSED:
        from deals.models import Deal  # noqa: PLC0415
        from deals.models_pipeline import Stage  # noqa: PLC0415

        won_stages = Stage.objects.filter(is_won_stage=True)
        qs = Deal.objects.filter(
            close_date__gte=start, close_date__lte=end, stage__in=won_stages,
        )
        if is_org:
            qs = qs.filter(tenant=goal.tenant)
        else:
            qs = qs.filter(owner_id=owner_id)
        return Decimal(qs.count())

    if metric == METRIC_LEADS_CREATED:
        from leads.models import Lead  # noqa: PLC0415

        qs = Lead.objects.filter(created_at__date__gte=start, created_at__date__lte=end)
        if is_org:
            qs = qs.filter(tenant=goal.tenant)
        else:
            qs = qs.filter(owner_id=owner_id)
        return Decimal(qs.count())

    if metric == METRIC_CALLS_MADE:
        from calls.models import Call  # noqa: PLC0415

        qs = Call.objects.filter(started_at__date__gte=start, started_at__date__lte=end)
        if is_org:
            qs = qs.filter(tenant=goal.tenant)
        else:
            qs = qs.filter(created_by_id=owner_id)
        return Decimal(qs.count())

    if metric == METRIC_MEETINGS_HELD:
        from events.models import Event  # noqa: PLC0415

        qs = Event.objects.filter(start__date__gte=start, start__date__lte=end)
        if is_org:
            qs = qs.filter(tenant=goal.tenant)
        else:
            qs = qs.filter(organizer_id=owner_id)
        return Decimal(qs.count())

    if metric == METRIC_EMAILS_SENT:
        from email_integration.models import Email  # noqa: PLC0415

        qs = Email.objects.filter(
            sent_at__date__gte=start, sent_at__date__lte=end,
            direction="outbound",
        )
        if is_org:
            qs = qs.filter(tenant=goal.tenant)
        else:
            qs = qs.filter(account__user_id=owner_id)
        return Decimal(qs.count())

    # METRIC_CUSTOM → caller is responsible for refreshing actual_amount
    # via the API; the service returns the stored value unchanged.
    return goal.actual_amount or Decimal(0)


###############################################################################
# refresh_all_goals
###############################################################################


def refresh_all_goals(tenant: "Organization | None" = None) -> dict[str, int]:
    """Recalculate ``actual_amount`` on every active :class:`Goal`.

    Called by the daily Celery beat task
    :func:`goals.tasks.refresh_all_goals`. Returns
    ``{refreshed: N, errors: M}``.
    """
    qs = Goal.objects.filter(is_active=True)
    if tenant is not None:
        qs = qs.filter(tenant=tenant)
    refreshed = 0
    errors = 0
    for goal in qs.iterator():
        try:
            new_actual = calculate_actual(goal)
        except Exception:  # pragma: no cover — defensive
            log.exception("refresh: goal %s failed", goal.pk)
            errors += 1
            continue
        if goal.actual_amount != new_actual:
            goal.actual_amount = new_actual
            goal.save(update_fields=["actual_amount", "updated_at"])
        refreshed += 1
    return {"refreshed": refreshed, "errors": errors}


###############################################################################
# get_leaderboard
###############################################################################


def get_leaderboard(
    metric: str,
    period_type: str = PERIOD_MONTHLY,
    *,
    ref: date | None = None,
    tenant: "Organization | None" = None,
    limit: int = 10,
) -> list[dict[str, Any]]:
    """Rank users by ``actual_amount`` for the given metric + period.

    Returns ``[{user_id, owner_id, actual_amount, rank}]`` (top N).
    """
    start, end = period_bounds(period_type, ref)
    qs = Goal.objects.filter(
        metric=metric, period_type=period_type,
        period_start=start, owner_type=OWNER_USER, is_active=True,
    )
    if tenant is not None:
        qs = qs.filter(tenant=tenant)
    qs = qs.order_by("-actual_amount")[:limit]
    return [
        {
            "rank": idx + 1,
            "user_id": int(g.owner_id) if g.owner_id.isdigit() else None,
            "actual_amount": str(g.actual_amount or Decimal(0)),
            "target_amount": str(g.target_amount or Decimal(0)),
        }
        for idx, g in enumerate(qs)
    ]


###############################################################################
# check_achievements
###############################################################################


def _award_badge(
    tenant: "Organization", user: "User", badge_type: str
) -> GoalAchievement | None:
    """Award a badge if not already awarded. Returns the row or ``None``."""
    badge, created = GoalAchievement.objects.get_or_create(
        tenant=tenant, user=user, badge_type=badge_type,
    )
    return badge if created else None


def check_achievements(user: "User", tenant: "Organization | None" = None) -> list[str]:
    """Check + award gamification badges for ``user``.

    Returns the list of badge types awarded (newly). Re-awards are
    no-ops (the row already exists).
    """
    from api.models import TenantMembership  # noqa: PLC0415

    if tenant is None:
        membership = TenantMembership.objects.filter(user=user, is_active=True).first()
        if membership is None:
            return []
        tenant = membership.tenant

    awarded: list[str] = []

    # 1. first_deal — user has at least 1 closed-won deal.
    from deals.models import Deal  # noqa: PLC0415
    from deals.models_pipeline import Stage  # noqa: PLC0415

    won_stages = Stage.objects.filter(is_won_stage=True)
    has_won = Deal.objects.filter(owner=user, stage__in=won_stages).exists()
    if has_won and _award_badge(tenant, user, BADGE_FIRST_DEAL):
        awarded.append(BADGE_FIRST_DEAL)

    # 2. 100k_deals — user has at least 100k total in won deals.
    agg = Deal.objects.filter(owner=user, stage__in=won_stages).aggregate(
        total=Sum("amount")
    )
    total_won = agg["total"] or Decimal(0)
    if total_won >= Decimal("100000") and _award_badge(tenant, user, BADGE_100K_DEALS):
        awarded.append(BADGE_100K_DEALS)

    # 3. 100_calls_week — user has >= 100 calls in the last 7 days.
    from calls.models import Call  # noqa: PLC0415

    week_ago = timezone.now() - timedelta(days=7)
    call_count = Call.objects.filter(owner=user, started_at__gte=week_ago).count()
    if call_count >= 100 and _award_badge(tenant, user, BADGE_100_CALLS_WEEK):
        awarded.append(BADGE_100_CALLS_WEEK)

    # 4. top_performer_month — user is rank 1 on the monthly revenue
    #    leaderboard.
    board = get_leaderboard(METRIC_REVENUE, PERIOD_MONTHLY, tenant=tenant, limit=1)
    if board and board[0]["user_id"] == user.pk:
        if _award_badge(tenant, user, BADGE_TOP_PERFORMER_MONTH):
            awarded.append(BADGE_TOP_PERFORMER_MONTH)

    return awarded


###############################################################################
# get_goal_progress
###############################################################################


def get_goal_progress(
    user: "User",
    metric: str,
    period_type: str = PERIOD_MONTHLY,
    *,
    ref: date | None = None,
    tenant: "Organization | None" = None,
) -> dict[str, Any]:
    """Return ``{target, actual, percentage, status}`` for the user × metric × period.

    ``status`` ∈ ``{"behind", "on_track", "exceeded"}`` —
    ``behind`` (< 50%), ``on_track`` (50–99%), ``exceeded`` (>= 100%).
    """
    start, end = period_bounds(period_type, ref)
    qs = Goal.objects.filter(
        owner_type=OWNER_USER, owner_id=str(user.pk),
        metric=metric, period_type=period_type, period_start=start,
        is_active=True,
    )
    if tenant is not None:
        qs = qs.filter(tenant=tenant)
    goal = qs.first()
    if goal is None:
        return {
            "target": "0", "actual": "0", "percentage": 0.0,
            "status": "behind", "found": False,
        }
    target = goal.target_amount or Decimal(0)
    actual = goal.actual_amount or Decimal(0)
    if target > 0:
        pct = float(actual / target * 100)
    else:
        pct = 100.0 if actual > 0 else 0.0
    if pct >= 100:
        status = "exceeded"
    elif pct >= 50:
        status = "on_track"
    else:
        status = "behind"
    return {
        "target": str(target),
        "actual": str(actual),
        "percentage": round(pct, 2),
        "status": status,
        "found": True,
        "goal_id": goal.pk,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
    }


__all__ = [
    "calculate_actual",
    "check_achievements",
    "get_goal_progress",
    "get_leaderboard",
    "period_bounds",
    "refresh_all_goals",
]
