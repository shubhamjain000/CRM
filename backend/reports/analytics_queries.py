"""Pre-built analytics queries — tenant-level sales / activity insights.

Every function returns a plain ``dict`` (JSON-serialisable) ready to be
rendered by a chart widget on a :class:`analytics.models.Dashboard`.

The functions all rely on the thread-local tenant set by
:class:`api.middleware.TenantMiddleware` (or :func:`api.managers.tenant_context`
in Celery workers / tests). They never take a tenant argument explicitly —
the ``tenant`` parameter is kept in the signature for explicitness when
called outside a request, but is only used as a fallback filter when no
thread-local tenant is bound.
"""

from __future__ import annotations

from collections import OrderedDict
from datetime import timedelta
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from django.db.models import (
    Avg,
    Count,
    Q,
    Sum,
)
from django.db.models.functions import (
    ExtractHour,
    ExtractWeekDay,
    TruncDate,
    TruncMonth,
)
from django.utils import timezone

from api.managers import get_current_tenant

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization


###############################################################################
# Helpers
###############################################################################


def _q(tenant: "Organization | None") -> Q:
    """Build a Q filtering by ``tenant`` — falls back to the thread-local."""
    t = tenant or get_current_tenant()
    if t is None:
        return Q()
    return Q(tenant_id=t.pk)


def _dec(value: Any) -> float:
    """Coerce Decimal/None → float for JSON-friendliness."""
    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def _resolve(queryset, tenant: "Organization | None"):
    """Apply the tenant filter (no-op when thread-local is bound)."""
    return queryset.filter(_q(tenant))


###############################################################################
# 1. Sales funnel
###############################################################################


def sales_funnel(tenant: "Organization | None" = None) -> dict[str, Any]:
    """Lead → Contact → Deal → Won funnel with per-stage conversion rates."""
    from contacts.models import Contact  # noqa: PLC0415
    from deals.models import Deal  # noqa: PLC0415
    from leads.models import Lead  # noqa: PLC0415

    leads = _resolve(Lead.objects.all(), tenant).count()
    contacts = _resolve(Contact.objects.all(), tenant).count()
    deals = _resolve(Deal.objects.all(), tenant).count()
    won = (
        _resolve(Deal.objects.all(), tenant)
        .filter(stage__is_won_stage=True)
        .count()
    )
    stages = [
        ("Leads", leads),
        ("Contacts", contacts),
        ("Deals", deals),
        ("Won", won),
    ]
    rates: list[dict[str, Any]] = []
    for i in range(1, len(stages)):
        prev = stages[i - 1][1]
        cur = stages[i][1]
        rate = round((cur / prev) * 100, 2) if prev else 0.0
        rates.append(
            {
                "from": stages[i - 1][0],
                "to": stages[i][0],
                "count": cur,
                "conversion_rate": rate,
            }
        )
    return {"stages": stages, "conversions": rates, "overall": round((won / leads) * 100, 2) if leads else 0.0}


###############################################################################
# 2. Win/loss analysis
###############################################################################


def win_loss_analysis(
    tenant: "Organization | None" = None,
    group_by: str = "reason",
) -> dict[str, Any]:
    """Win/loss breakdown grouped by ``reason`` / ``rep`` / ``stage`` /
    ``source`` / ``industry`` / ``deal_size``."""
    from deals.models import Deal  # noqa: PLC0415

    qs = _resolve(Deal.objects.all(), tenant).filter(
        stage__is_closed=True
    ).select_related("stage", "owner", "account")

    group_field = {
        "reason": "lost_reason",
        "rep": "owner_id",
        "stage": "stage_id",
        "source": "lead_source",
        "industry": "account__industry",
        "deal_size": None,
    }.get(group_by)

    rows: list[dict[str, Any]] = []
    if group_by == "deal_size":
        # Bucket by amount: <5k / 5k-25k / 25k-100k / >100k.
        buckets = OrderedDict(
            [
                ("<5k", (0, 5000)),
                ("5k-25k", (5000, 25000)),
                ("25k-100k", (25000, 100000)),
                (">100k", (100000, None)),
            ]
        )
        for label, (lo, hi) in buckets.items():
            base = qs.filter(amount__gte=lo)
            if hi is not None:
                base = base.filter(amount__lt=hi)
            won = base.filter(stage__is_won_stage=True).count()
            lost = base.filter(stage__is_lost_stage=True).count()
            rows.append(
                {"label": label, "won": won, "lost": lost, "win_rate": _rate(won, won + lost)}
            )
    else:
        values_expr = group_field or "lost_reason"
        annotations = qs.values(values_expr).annotate(
            won=Count("id", filter=Q(stage__is_won_stage=True)),
            lost=Count("id", filter=Q(stage__is_lost_stage=True)),
        )
        for row in annotations:
            label = row.get(values_expr) or "(none)"
            won = row["won"]
            lost = row["lost"]
            rows.append(
                {"label": str(label), "won": won, "lost": lost, "win_rate": _rate(won, won + lost)}
            )
    return {"group_by": group_by, "rows": rows}


def _rate(won: int, total: int) -> float:
    return round((won / total) * 100, 2) if total else 0.0


###############################################################################
# 3. Lead conversion rate
###############################################################################


def lead_conversion_rate(
    tenant: "Organization | None" = None,
    group_by: str = "source",
) -> dict[str, Any]:
    """Lead conversion rate grouped by ``source`` / ``time`` / ``rep`` /
    ``industry``."""
    from leads.models import Lead  # noqa: PLC0415

    qs = _resolve(Lead.objects.all(), tenant)
    if group_by == "source":
        annotations = qs.values("lead_source").annotate(
            total=Count("id"),
            converted=Count("id", filter=Q(is_converted=True)),
        )
        rows = [
            {
                "label": r["lead_source"] or "(none)",
                "total": r["total"],
                "converted": r["converted"],
                "rate": _rate(r["converted"], r["total"]),
            }
            for r in annotations
        ]
    elif group_by == "rep":
        annotations = qs.values("assigned_to_id").annotate(
            total=Count("id"),
            converted=Count("id", filter=Q(is_converted=True)),
        ).order_by("-total")
        rows = [
            {
                "label": f"user-{r['assigned_to_id']}",
                "total": r["total"],
                "converted": r["converted"],
                "rate": _rate(r["converted"], r["total"]),
            }
            for r in annotations
        ]
    elif group_by == "industry":
        annotations = qs.values("industry").annotate(
            total=Count("id"),
            converted=Count("id", filter=Q(is_converted=True)),
        )
        rows = [
            {
                "label": r["industry"] or "(none)",
                "total": r["total"],
                "converted": r["converted"],
                "rate": _rate(r["converted"], r["total"]),
            }
            for r in annotations
        ]
    elif group_by == "time":
        annotations = (
            qs.annotate(month=TruncMonth("created_at"))
            .values("month")
            .annotate(
                total=Count("id"),
                converted=Count("id", filter=Q(is_converted=True)),
            )
            .order_by("month")
        )
        rows = [
            {
                "label": r["month"].isoformat() if r["month"] else "(none)",
                "total": r["total"],
                "converted": r["converted"],
                "rate": _rate(r["converted"], r["total"]),
            }
            for r in annotations
        ]
    else:
        rows = []
    return {"group_by": group_by, "rows": rows}


###############################################################################
# 4. Sales-cycle length
###############################################################################


def sales_cycle_length(
    tenant: "Organization | None" = None,
    group_by: str = "stage",
) -> dict[str, Any]:
    """Avg days from ``Deal.created_at`` to ``Deal.close_date`` for won deals.

    Grouped by ``stage`` / ``deal_size`` / ``industry``. Computed in Python
    (rather than via ORM date-difference aggregates) so the function is
    portable across SQLite / Postgres without needing a database-specific
    duration-expression helper.
    """
    from deals.models import Deal  # noqa: PLC0415

    qs = (
        _resolve(Deal.objects.all(), tenant)
        .filter(stage__is_won_stage=True, close_date__isnull=False)
        .select_related("stage", "account")
    )

    def _bucket(deal: Deal) -> str:
        if group_by == "stage":
            return f"stage-{deal.stage_id}"
        if group_by == "industry":
            return (getattr(deal.account, "industry", "") if deal.account else "") or "(none)"
        if group_by == "deal_size":
            amt = float(deal.amount or 0)
            if amt < 5000:
                return "<5k"
            if amt < 25000:
                return "5k-25k"
            if amt < 100000:
                return "25k-100k"
            return ">100k"
        return "(all)"

    buckets: dict[str, list[float]] = {}
    for deal in qs.iterator():
        created_date = deal.created_at.date()
        delta_days = (deal.close_date - created_date).days
        if delta_days < 0:
            continue
        buckets.setdefault(_bucket(deal), []).append(float(delta_days))

    rows: list[dict[str, Any]] = []
    for label, vals in sorted(buckets.items()):
        if not vals:
            continue
        rows.append(
            {
                "label": label,
                "avg_days": round(sum(vals) / len(vals), 2),
                "min_days": min(vals),
                "max_days": max(vals),
                "count": len(vals),
            }
        )
    return {"group_by": group_by, "rows": rows}


###############################################################################
# 5. Deal-size distribution
###############################################################################


def deal_size_distribution(
    tenant: "Organization | None" = None,
    *,
    bins: int = 10,
) -> dict[str, Any]:
    """Histogram of deal amounts."""
    from deals.models import Deal  # noqa: PLC0415

    qs = _resolve(Deal.objects.all(), tenant)
    amounts = list(qs.values_list("amount", flat=True))
    if not amounts:
        return {"labels": [], "counts": [], "min": 0, "max": 0}
    mn = _dec(min(amounts))
    mx = _dec(max(amounts))
    if mx == mn:
        mx = mn + 1
    step = (mx - mn) / bins
    labels = [f"{mn + i * step:.0f}-{mn + (i + 1) * step:.0f}" for i in range(bins)]
    counts = [0] * bins
    for a in amounts:
        idx = min(int((_dec(a) - mn) / step), bins - 1)
        counts[idx] += 1
    return {"labels": labels, "counts": counts, "min": mn, "max": mx}


###############################################################################
# 6. Rep performance
###############################################################################


def rep_performance(tenant: "Organization | None" = None) -> dict[str, Any]:
    """Per-rep rollup: calls, emails, meetings, deals, revenue, conversion rate."""
    from calls.models import Call  # noqa: PLC0415
    from deals.models import Deal  # noqa: PLC0415
    from events.models import Event  # noqa: PLC0415
    from leads.models import Lead  # noqa: PLC0415

    deal_qs = _resolve(Deal.objects.all(), tenant)
    rep_ids = set(
        list(deal_qs.values_list("owner_id", flat=True))
        + list(_resolve(Lead.objects.all(), tenant).values_list("assigned_to_id", flat=True))
    )
    rows: list[dict[str, Any]] = []
    for rid in rep_ids:
        if rid is None:
            continue
        deals_won = deal_qs.filter(owner_id=rid, stage__is_won_stage=True)
        revenue = _dec(deals_won.aggregate(s=Sum("amount"))["s"])
        total_deals = deal_qs.filter(owner_id=rid).count()
        leads_total = _resolve(Lead.objects.all(), tenant).filter(assigned_to_id=rid).count()
        leads_conv = _resolve(Lead.objects.all(), tenant).filter(
            assigned_to_id=rid, is_converted=True
        ).count()
        calls = _resolve(Call.objects.all(), tenant).filter(created_by_id=rid).count()
        events = _resolve(Event.objects.all(), tenant).filter(created_by_id=rid).count()
        # Emails sent by this rep — fall back to 0 when email_integration
        # isn't installed (lazy import).
        emails = 0
        try:
            from email_integration.models import Email  # noqa: PLC0415

            emails = _resolve(Email.objects.all(), tenant).filter(
                created_by_id=rid, direction="outbound"
            ).count()
        except Exception:  # pragma: no cover — email_integration optional
            pass
        rows.append(
            {
                "rep_id": rid,
                "deals": total_deals,
                "won": deals_won.count(),
                "revenue": revenue,
                "calls": calls,
                "emails": emails,
                "meetings": events,
                "lead_conversion_rate": _rate(leads_conv, leads_total) if leads_total else 0.0,
            }
        )
    rows.sort(key=lambda r: r["revenue"], reverse=True)
    return {"rows": rows}


###############################################################################
# 7. Activity heatmap (day × hour)
###############################################################################


def activity_heatmap(tenant: "Organization | None" = None) -> dict[str, Any]:
    """7-day × 24-hour matrix of activity counts."""
    from crm_ux.models import Activity  # noqa: PLC0415

    qs = _resolve(Activity.objects.all(), tenant)
    # Weekday: Django ExtractWeekDay returns 1 (Sunday) .. 7 (Saturday).
    annotations = (
        qs.annotate(
            dow=ExtractWeekDay("created_at"),
            hour=ExtractHour("created_at"),
        )
        .values("dow", "hour")
        .annotate(count=Count("id"))
    )
    # Build a 7x24 matrix indexed [day][hour].
    matrix = [[0] * 24 for _ in range(7)]
    for row in annotations:
        dow = row["dow"] - 1  # 0..6 (Sunday-first)
        if 0 <= dow < 7 and 0 <= row["hour"] < 24:
            matrix[dow][row["hour"]] = row["count"]
    return {
        "x": ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
        "y": [f"{h:02d}:00" for h in range(24)],
        "values": matrix,
    }


###############################################################################
# 8. Pipeline velocity
###############################################################################


def pipeline_velocity(tenant: "Organization | None" = None) -> dict[str, Any]:
    """Deals moving through stages over time (count per stage per week)."""
    from deals.models import DealStageHistory  # noqa: PLC0415

    qs = _resolve(DealStageHistory.objects.all(), tenant)
    annotations = (
        qs.annotate(week=TruncDate("changed_at"))
        .values("week", "to_stage_id")
        .annotate(count=Count("id"))
        .order_by("week", "to_stage_id")
    )
    series: dict[str, list[dict[str, Any]]] = {}
    for row in annotations:
        label = f"stage-{row['to_stage_id']}"
        series.setdefault(label, []).append(
            {"x": row["week"].isoformat() if row["week"] else None, "y": row["count"]}
        )
    return {"series": series}


###############################################################################
# 9. Source ROI
###############################################################################


def source_roi(tenant: "Organization | None" = None) -> dict[str, Any]:
    """Revenue by lead source."""
    from deals.models import Deal  # noqa: PLC0415

    qs = (
        _resolve(Deal.objects.all(), tenant)
        .filter(stage__is_won_stage=True)
    )
    annotations = (
        qs.values("lead_source")
        .annotate(revenue=Sum("amount"), deals=Count("id"))
        .order_by("-revenue")
    )
    rows = [
        {
            "label": r["lead_source"] or "(none)",
            "revenue": _dec(r["revenue"]),
            "deals": r["deals"],
        }
        for r in annotations
    ]
    return {"rows": rows}


###############################################################################
# 10. Email engagement
###############################################################################


def email_engagement(
    tenant: "Organization | None" = None,
    group_by: str = "template",
) -> dict[str, Any]:
    """Open / click / reply rates by ``template`` / ``rep``."""
    try:
        from email_integration.models import Email  # noqa: PLC0415
    except ImportError:
        return {"group_by": group_by, "rows": []}

    qs = _resolve(Email.objects.all(), tenant)
    field = "template_id" if group_by == "template" else "created_by_id"
    if group_by == "template" and not hasattr(Email, "template_id"):
        field = "created_by_id"
    annotations = (
        qs.values(field)
        .annotate(
            sent=Count("id"),
            opened=Count("id", filter=Q(opened_at__isnull=False)),
            clicked=Count("id", filter=Q(clicked_at__isnull=False)),
            replied=Count("id", filter=Q(direction="inbound")),
        )
    )
    rows = []
    for r in annotations:
        sent = r["sent"]
        rows.append(
            {
                "label": str(r.get(field) or "(none)"),
                "sent": sent,
                "opens": r["opened"],
                "clicks": r["clicked"],
                "replies": r["replied"],
                "open_rate": _rate(r["opened"], sent),
                "click_rate": _rate(r["clicked"], sent),
                "reply_rate": _rate(r["replied"], sent),
            }
        )
    return {"group_by": group_by, "rows": rows}


###############################################################################
# 11. Call analytics
###############################################################################


def call_analytics(tenant: "Organization | None" = None) -> dict[str, Any]:
    """Call volume, duration, and outcome breakdown by rep."""
    from calls.models import Call  # noqa: PLC0415

    qs = _resolve(Call.objects.all(), tenant)
    annotations = (
        qs.values("created_by_id")
        .annotate(
            calls=Count("id"),
            avg_duration=Avg("duration"),
            total_duration=Sum("duration"),
        )
        .order_by("-calls")
    )
    rows = [
        {
            "rep_id": r["created_by_id"],
            "calls": r["calls"],
            "avg_duration_secs": int(r["avg_duration"] or 0),
            "total_duration_secs": int(r["total_duration"] or 0),
        }
        for r in annotations
    ]
    # Outcome distribution (across all reps).
    outcome_dist = list(
        qs.values("outcome").annotate(count=Count("id")).order_by("-count")
    )
    return {"rows": rows, "outcomes": outcome_dist}


###############################################################################
# 12. Cohort retention
###############################################################################


def cohort_retention(
    tenant: "Organization | None" = None,
    *,
    months: int = 12,
) -> dict[str, Any]:
    """Signup month × months-since-signup retention matrix (% active).

    "Active" is approximated by the presence of any :class:`Activity` row
    for the user in the given month bucket. (A production deployment would
    use a stricter definition based on session / login events.)
    """
    from api.models import TenantMembership  # noqa: PLC0415
    from crm_ux.models import Activity  # noqa: PLC0415

    now = timezone.now()
    cutoff = now - timedelta(days=months * 31)
    members = _resolve(TenantMembership.objects.all(), tenant).filter(
        created_at__gte=cutoff
    ).annotate(cohort=TruncMonth("created_at")).values("cohort", "user_id")
    cohort_users: dict[Any, set[int]] = {}
    for row in members:
        cohort_users.setdefault(row["cohort"], set()).add(row["user_id"])

    activities = (
        _resolve(Activity.objects.all(), tenant)
        .filter(created_at__gte=cutoff)
        .annotate(month=TruncMonth("created_at"))
        .values_list("month", "user_id")
    )
    activity_by_month: dict[Any, set[int]] = {}
    for month, uid in activities:
        activity_by_month.setdefault(month, set()).add(uid)

    matrix: list[dict[str, Any]] = []
    for cohort, users in sorted(cohort_users.items(), key=lambda kv: kv[0]):
        size = len(users)
        row: dict[str, Any] = {"cohort": cohort.isoformat(), "size": size, "months": []}
        for offset in range(months):
            month = (cohort.replace(day=1) + timedelta(days=offset * 31)).replace(day=1)
            if month > now:
                break
            active = len(users & activity_by_month.get(month, set()))
            pct = round((active / size) * 100, 2) if size else 0.0
            row["months"].append({"offset": offset, "active": active, "pct": pct})
        matrix.append(row)
    return {"matrix": matrix}


__all__ = [
    "activity_heatmap",
    "call_analytics",
    "cohort_retention",
    "deal_size_distribution",
    "email_engagement",
    "lead_conversion_rate",
    "pipeline_velocity",
    "rep_performance",
    "sales_cycle_length",
    "sales_funnel",
    "source_roi",
    "win_loss_analysis",
]
