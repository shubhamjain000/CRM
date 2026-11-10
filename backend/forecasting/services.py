"""Service layer for the forecasting app.

The forecasting service translates the user's open deals (with their
forecast categories) into a per-period forecast amount. Five functions:

* :func:`calculate_forecast` — auto-calculate a single (user, period,
  category) bucket from open deals. Categories are derived from the
  deal's stage (see :mod:`deals.models_pipeline`):
  ``pipeline`` (early stages), ``best_case`` (negotiation / proposal),
  ``commit`` (rep confident — currently overlaps best_case unless
  overridden via ``probability >= 75``), ``closed`` (won), ``omitted``
  (lost).
* :func:`submit_forecast` — stamp ``submitted_at``.
* :func:`approve_forecast` — stamp ``approved_by`` / ``approved_at``.
* :func:`roll_up` — aggregate team forecasts for a manager's direct
  reports (``manager_id``).
* :func:`get_accuracy` — predicted vs actual (closed) for past periods.
* :func:`get_scenarios` — best / worst / most-likely for the period.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from django.db.models import Q, Sum
from django.utils import timezone

from .models import (
    CATEGORY_BEST_CASE,
    CATEGORY_CLOSED,
    CATEGORY_COMMIT,
    CATEGORY_OMITTED,
    CATEGORY_PIPELINE,
    Forecast,
    ForecastAdjustment,
    PERIOD_MONTHLY,
    PERIOD_QUARTERLY,
    PERIOD_WEEKLY,
    PERIOD_YEARLY,
)

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization, User


###############################################################################
# Period helpers
###############################################################################


def period_bounds(
    period_type: str, period_start: date
) -> tuple[date, date]:
    """Return ``(period_start, period_end)`` for the given period.

    ``period_end`` is inclusive. ``period_start`` is treated as the start
    of the period (week = Monday, month = 1st, quarter = Q-start,
    year = Jan 1).
    """
    if period_type == PERIOD_WEEKLY:
        start = period_start - timedelta(days=period_start.weekday())
        return start, start + timedelta(days=6)
    if period_type == PERIOD_MONTHLY:
        start = period_start.replace(day=1)
        # Last day of the month.
        next_month = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
        return start, next_month - timedelta(days=1)
    if period_type == PERIOD_QUARTERLY:
        q = (period_start.month - 1) // 3  # 0..3
        start = period_start.replace(month=q * 3 + 1, day=1)
        end_month = q * 3 + 3
        if end_month == 12:
            end = start.replace(month=12, day=31)
        else:
            end = start.replace(month=end_month + 1, day=1) - timedelta(days=1)
        return start, end
    if period_type == PERIOD_YEARLY:
        start = period_start.replace(month=1, day=1)
        return start, start.replace(month=12, day=31)
    raise ValueError(f"Unknown period_type: {period_type!r}")


###############################################################################
# Category → deal-stage mapping
###############################################################################


def _deal_filter_for_category(category: str) -> Q:
    """Return a :class:`Q` matching deals whose forecast_category equals
    the requested bucket.

    Deals carry a ``forecast_category`` field (mirrored from their stage
    by :class:`deals.services.PipelineService.transition_deal`). For the
    ``commit`` bucket, we additionally include ``best_case`` deals with
    ``probability >= 75`` (a sales-rep-confidence heuristic).
    """
    if category == CATEGORY_COMMIT:
        return Q(forecast_category=CATEGORY_COMMIT) | (
            Q(forecast_category=CATEGORY_BEST_CASE) & Q(probability__gte=75.0)
        )
    if category == CATEGORY_CLOSED:
        # Closed-won only — closed-lost deals have category 'omitted'.
        return Q(forecast_category=CATEGORY_CLOSED)
    if category == CATEGORY_OMITTED:
        return Q(forecast_category=CATEGORY_OMITTED)
    if category == CATEGORY_BEST_CASE:
        return Q(forecast_category=CATEGORY_BEST_CASE)
    # Default → pipeline.
    return Q(forecast_category=CATEGORY_PIPELINE)


###############################################################################
# Core: calculate_forecast
###############################################################################


def calculate_forecast(
    user: "User",
    period_type: str,
    period_start: date,
    *,
    category: str = CATEGORY_PIPELINE,
    tenant: "Organization | None" = None,
) -> Decimal:
    """Auto-calculate the forecast amount for (user, period, category).

    Sums ``Deal.amount`` for the user's open deals whose
    ``forecast_category`` matches the requested bucket AND whose
    ``close_date`` falls inside the period window. Returns a Decimal
    (``0`` if no deals match).
    """
    from deals.models import Deal  # noqa: PLC0415

    start, end = period_bounds(period_type, period_start)
    qs = Deal.objects.filter(owner=user, close_date__gte=start, close_date__lte=end)
    if tenant is not None:
        qs = qs.filter(tenant=tenant)
    qs = qs.filter(_deal_filter_for_category(category))
    agg = qs.aggregate(total=Sum("amount"))
    return agg["total"] or Decimal(0)


def get_or_create_forecast(
    *,
    tenant: "Organization",
    user: "User",
    period_type: str,
    period_start: date,
    category: str = CATEGORY_PIPELINE,
) -> Forecast:
    """Idempotently fetch or create a :class:`Forecast` row + recalc amount."""
    start, end = period_bounds(period_type, period_start)
    forecast, _ = Forecast.objects.get_or_create(
        tenant=tenant,
        user=user,
        period_type=period_type,
        period_start=start,
        category=category,
        defaults={"period_end": end},
    )
    if forecast.period_end is None or forecast.period_end != end:
        forecast.period_end = end
    new_amount = calculate_forecast(
        user, period_type, start, category=category, tenant=tenant
    )
    if forecast.amount != new_amount:
        forecast.amount = new_amount
    forecast.save()
    return forecast


###############################################################################
# Submit / approve
###############################################################################


def submit_forecast(forecast: Forecast) -> Forecast:
    """Mark the forecast as submitted (stamp ``submitted_at``)."""
    forecast.submitted_at = timezone.now()
    forecast.save(update_fields=["submitted_at", "updated_at"])
    return forecast


def approve_forecast(forecast: Forecast, approver: "User") -> Forecast:
    """Mark the forecast as approved by ``approver``."""
    forecast.approved_by = approver
    forecast.approved_at = timezone.now()
    forecast.save(update_fields=["approved_by", "approved_at", "updated_at"])
    return forecast


def apply_override(
    forecast: Forecast,
    new_amount: Decimal,
    *,
    adjusted_by: "User | None" = None,
    reason: str = "",
) -> Forecast:
    """Set ``override_amount`` and log a :class:`ForecastAdjustment` row."""
    old_amount = forecast.override_amount if forecast.override_amount is not None else forecast.amount
    forecast.override_amount = new_amount
    forecast.save(update_fields=["override_amount", "updated_at"])
    ForecastAdjustment.objects.create(
        tenant=forecast.tenant,
        forecast=forecast,
        adjusted_by=adjusted_by,
        old_amount=old_amount,
        new_amount=new_amount,
        reason=reason,
    )
    return forecast


###############################################################################
# Roll-up + accuracy + scenarios
###############################################################################


def _direct_reports(manager: "User") -> "list[User]":
    """Return the list of users who report to ``manager``.

    Resolved via :class:`api.models.Team.lead` — every member of every
    team led by ``manager`` is considered a direct report.
    """
    from api.models import Team  # noqa: PLC0415

    team_ids = Team.objects.filter(lead=manager).values_list("pk", flat=True)
    if not team_ids:
        return []
    # Team has no direct members list in the schema; fall back to deals
    # owners under the manager's tenant. (Pragmatic: any user owning at
    # least one deal in the same tenant as the manager is a "report".)
    from deals.models import Deal  # noqa: PLC0415

    owner_ids = set(
        Deal.objects.filter(tenant=manager.memberships.first().tenant)
        .values_list("owner_id", flat=True)
        .distinct()
    )
    owner_ids.discard(manager.pk)
    from api.models import User  # noqa: PLC0415

    return list(User.objects.filter(pk__in=owner_ids))


def roll_up(
    manager: "User",
    period_type: str,
    period_start: date,
    *,
    tenant: "Organization | None" = None,
) -> dict[str, Any]:
    """Aggregate team forecasts for ``manager``'s direct reports.

    Returns ``{manager_id, period_type, period_start, period_end,
    total_amount, by_category: {pipeline: x, best_case: y, ...},
    by_user: [{user_id, total_amount, categories: {...}}]}``.
    """
    start, end = period_bounds(period_type, period_start)
    reports = _direct_reports(manager)
    if not reports:
        return {
            "manager_id": manager.pk,
            "period_type": period_type,
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "total_amount": "0",
            "by_category": {},
            "by_user": [],
        }

    qs = Forecast.objects.filter(
        user__in=reports,
        period_type=period_type,
        period_start=start,
    )
    if tenant is not None:
        qs = qs.filter(tenant=tenant)

    by_category: dict[str, str] = {}
    by_user: dict[int, dict[str, Any]] = {}
    grand_total = Decimal(0)
    for fc in qs:
        amt = fc.effective_amount
        grand_total += amt
        by_category[fc.category] = str(
            (Decimal(by_category.get(fc.category, "0")) + amt)
        )
        u = by_user.setdefault(fc.user_id, {
            "user_id": fc.user_id, "total_amount": Decimal(0), "categories": {}
        })
        u["total_amount"] += amt
        u["categories"][fc.category] = str(
            (Decimal(u["categories"].get(fc.category, "0")) + amt)
        )

    return {
        "manager_id": manager.pk,
        "period_type": period_type,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "total_amount": str(grand_total),
        "by_category": by_category,
        "by_user": [
            {**u, "total_amount": str(u["total_amount"])} for u in by_user.values()
        ],
    }


def get_accuracy(user: "User", periods_back: int = 3) -> dict[str, Any]:
    """Compare predicted (commit) vs actual (closed) for the last N months.

    Returns ``{periods: [{period_start, predicted, actual, accuracy_pct}],
    average_accuracy_pct}``.
    """
    today = date.today()
    periods: list[dict[str, Any]] = []
    accuracies: list[float] = []
    for i in range(1, periods_back + 1):
        # Month start ``i`` months ago.
        if today.month - i < 1:
            year = today.year - 1
            month = today.month - i + 12
        else:
            year = today.year
            month = today.month - i
        start = today.replace(year=year, month=month, day=1)
        end = (start.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)

        commit = Forecast.objects.filter(
            user=user, period_type=PERIOD_MONTHLY, period_start=start,
            category=CATEGORY_COMMIT,
        ).first()
        closed = Forecast.objects.filter(
            user=user, period_type=PERIOD_MONTHLY, period_start=start,
            category=CATEGORY_CLOSED,
        ).first()
        predicted = (commit.effective_amount if commit else Decimal(0))
        actual = (closed.effective_amount if closed else Decimal(0))
        if predicted > 0:
            acc = float(actual / predicted * 100)
        elif actual > 0:
            acc = 0.0  # under-predicted badly
        else:
            acc = 100.0  # both zero = perfect
        accuracies.append(acc)
        periods.append({
            "period_start": start.isoformat(),
            "predicted": str(predicted),
            "actual": str(actual),
            "accuracy_pct": round(acc, 2),
        })
    avg = round(sum(accuracies) / len(accuracies), 2) if accuracies else 0.0
    return {"periods": periods, "average_accuracy_pct": avg}


def get_scenarios(
    user: "User",
    period_type: str,
    period_start: date,
    *,
    tenant: "Organization | None" = None,
) -> dict[str, Any]:
    """Return best / worst / most-likely forecast scenarios for the period.

    * **most_likely** — sum of weighted expected revenue (``amount *
      probability / 100``) of all open deals closing in the period.
    * **best** — sum of all ``amount`` of open deals closing in the
      period (everything closes).
    * **worst** — sum of ``amount`` of deals whose ``probability >= 75``
      (commit-equivalent).
    """
    from deals.models import Deal  # noqa: PLC0415

    start, end = period_bounds(period_type, period_start)
    qs = Deal.objects.filter(owner=user, close_date__gte=start, close_date__lte=end)
    if tenant is not None:
        qs = qs.filter(tenant=tenant)
    # Exclude closed-lost deals.
    qs = qs.exclude(forecast_category=CATEGORY_OMITTED)

    best = Decimal(0)
    worst = Decimal(0)
    most_likely = Decimal(0)
    for deal in qs.only("amount", "probability"):
        amt = deal.amount or Decimal(0)
        prob = Decimal(str(deal.probability or 0))
        best += amt
        most_likely += amt * prob / Decimal(100)
        if prob >= 75:
            worst += amt

    return {
        "user_id": user.pk,
        "period_type": period_type,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "best": str(best),
        "worst": str(worst),
        "most_likely": str(most_likely),
    }


__all__ = [
    "apply_override",
    "approve_forecast",
    "calculate_forecast",
    "get_accuracy",
    "get_or_create_forecast",
    "get_scenarios",
    "period_bounds",
    "roll_up",
    "submit_forecast",
]
