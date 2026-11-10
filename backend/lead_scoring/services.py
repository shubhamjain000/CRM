"""Service layer for the lead_scoring app.

Heuristic scoring:

* +5 if the lead has an email.
* +5 if the lead has a phone.
* +20 if the lead has a company name (B2B intent).
* +0 / +15 / +30 by annual-revenue tier (<$1M / $1M-$10M / >$10M).
* +0 / +10 / +15 / +20 by source (organic / web / referral / partner).

Capped at 100. ``score_all_leads()`` is the Celery-beat nightly sweep;
``get_hot_leads()`` returns leads with score > 80.

The service talks to the CRM ``leads`` app via lazy imports so the
module load stays cheap.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from django.db import transaction
from django.utils import timezone

from .models import MODEL_VERSION, LeadScore

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization

log = logging.getLogger(__name__)

HOT_LEAD_THRESHOLD = 80

_REVENUE_TIERS = [
    (1_000_000, 0),       # below $1M
    (10_000_000, 15),     # $1M–$10M
    (None, 30),           # above $10M
]

_SOURCE_WEIGHTS = {
    "organic": 0,
    "web": 10,
    "referral": 15,
    "partner": 20,
}


def _revenue_tier_score(annual_revenue: float | None) -> int:
    if annual_revenue is None or annual_revenue <= 0:
        return 0
    for ceiling, pts in _REVENUE_TIERS:
        if ceiling is None or annual_revenue < ceiling:
            return pts
    return _REVENUE_TIERS[-1][1]


def _extract_lead_fields(lead: Any) -> dict[str, Any]:
    """Pull the scoring-relevant fields off a Lead instance (duck-typed)."""
    annual_revenue = getattr(lead, "annual_revenue", None)
    if hasattr(annual_revenue, "__float__"):
        try:
            annual_revenue = float(annual_revenue)
        except (TypeError, ValueError):
            annual_revenue = None
    return {
        "email": getattr(lead, "email", "") or "",
        "phone": getattr(lead, "phone", "") or "",
        "company": getattr(lead, "company", "") or getattr(lead, "account_name", "") or "",
        "annual_revenue": annual_revenue,
        "source": getattr(lead, "lead_source", "") or getattr(lead, "source", "") or "",
    }


def compute_factors(fields: dict[str, Any]) -> dict[str, int]:
    """Return the JSON breakdown of points per factor (max 100)."""
    has_email = 5 if (fields.get("email") or "").strip() else 0
    has_phone = 5 if (fields.get("phone") or "").strip() else 0
    company_match = 20 if (fields.get("company") or "").strip() else 0
    revenue_tier = _revenue_tier_score(fields.get("annual_revenue"))
    source_weight = _SOURCE_WEIGHTS.get(
        (fields.get("source") or "").strip().lower(), 0
    )
    return {
        "has_email": has_email,
        "has_phone": has_phone,
        "company_match": company_match,
        "revenue_tier": revenue_tier,
        "source_weight": source_weight,
    }


def score_from_factors(factors: dict[str, int]) -> int:
    return max(0, min(100, sum(factors.values())))


@transaction.atomic
def score_lead(lead_id: str, *, tenant: "Organization | None" = None) -> LeadScore:
    """Compute + persist the score for ``lead_id`` (tenant from thread-local
    when ``None``).

    Looks the Lead up via the CRM ``leads`` app; if the lead row does not
    exist, an empty-fields score of 0 is recorded (so the row remains
    queryable but flags the lead as cold).
    """
    from api.managers import get_current_tenant  # noqa: PLC0415

    if tenant is None:
        tenant = get_current_tenant()

    fields: dict[str, Any] = {}
    try:
        from leads.models import Lead  # noqa: PLC0415

        lead = Lead.objects.filter(pk=lead_id).first()
        if lead is not None:
            fields = _extract_lead_fields(lead)
    except Exception:  # pragma: no cover — leads app may be uninstalled
        log.exception("score_lead: could not introspect Lead %s", lead_id)

    factors = compute_factors(fields)
    score = score_from_factors(factors)

    if tenant is None:
        raise RuntimeError("score_lead requires a tenant context.")

    obj, _ = LeadScore.objects.update_or_create(
        tenant=tenant,
        lead_id=str(lead_id),
        defaults={
            "score": score,
            "factors": factors,
            "model_version": MODEL_VERSION,
            "calculated_at": timezone.now(),
        },
    )
    return obj


def score_all_leads(tenant: "Organization | None" = None) -> dict[str, int]:
    """Re-score every Lead in ``tenant`` (or every tenant when ``None``).

    Called nightly by the ``lead-score-all`` Celery beat entry.
    """
    try:
        from leads.models import Lead  # noqa: PLC0415
    except Exception:  # pragma: no cover
        log.exception("score_all_leads: leads app unavailable")
        return {"scored": 0, "errors": 0}

    qs = Lead.objects.all()
    if tenant is not None:
        qs = qs.filter(tenant=tenant)
    scored = 0
    errors = 0
    for lead in qs.iterator():
        try:
            score_lead(str(lead.pk), tenant=lead.tenant)
            scored += 1
        except Exception:  # pragma: no cover — defensive
            log.exception("score_lead failed for %s", lead.pk)
            errors += 1
    return {"scored": scored, "errors": errors}


def get_hot_leads(
    tenant: "Organization | None" = None, *, limit: int = 50
) -> list[LeadScore]:
    """Return the top ``limit`` LeadScore rows with score > 80."""
    qs = LeadScore.objects.filter(score__gt=HOT_LEAD_THRESHOLD)
    if tenant is not None:
        qs = qs.filter(tenant=tenant)
    return list(qs.order_by("-score")[:limit])


__all__ = [
    "HOT_LEAD_THRESHOLD",
    "compute_factors",
    "get_hot_leads",
    "score_all_leads",
    "score_from_factors",
    "score_lead",
]
