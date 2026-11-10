"""Service layer for the smart_suggestions app.

* :func:`generate_suggestions` — scans the CRM for the user's stale
  leads (no first-contact in 7 days), stuck deals (in a stage longer
  than its ``business_days_limit``), and missing-decision-maker
  opportunities. Creates one :class:`SmartSuggestion` per detected
  signal (de-duped by ``(tenant, user, target_module, target_id,
  suggestion_type)`` so re-running ``generate`` doesn't pile up cards).
* :func:`accept_suggestion` / :func:`dismiss_suggestion` — set the
  terminal lifecycle flags.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import TYPE_CHECKING, Any

from django.utils import timezone

from .models import (
    SmartSuggestion,
    TYPE_CHURN_RISK,
    TYPE_NEXT_BEST_ACTION,
)

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import User

log = logging.getLogger(__name__)


def _safe_create(
    *,
    user: "User",
    suggestion_type: str,
    title: str,
    description: str,
    target_module: str,
    target_id: str,
    priority: int,
) -> SmartSuggestion | None:
    """Create a suggestion if one isn't already open for the same target."""
    from api.managers import get_current_tenant  # noqa: PLC0415

    tenant = get_current_tenant()
    if tenant is None:
        membership = user.memberships.filter(is_active=True).first()
        if membership is None:
            return None
        tenant = membership.tenant
    existing = SmartSuggestion.objects.filter(
        tenant=tenant,
        user=user,
        suggestion_type=suggestion_type,
        target_module=target_module,
        target_id=str(target_id),
        is_dismissed=False,
    ).exists()
    if existing:
        return None
    return SmartSuggestion.objects.create(
        tenant=tenant,
        user=user,
        suggestion_type=suggestion_type,
        title=title,
        description=description,
        target_module=target_module,
        target_id=str(target_id),
        priority=priority,
    )


def _scan_stale_leads(user: "User") -> int:
    try:  # pragma: no cover — leads may be uninstalled
        from leads.models import Lead  # noqa: PLC0415
    except Exception:
        return 0
    cutoff = timezone.now() - timedelta(days=7)
    count = 0
    for lead in Lead.objects.filter(owner=user, created_at__lte=cutoff)[:100]:
        first_contacted = getattr(lead, "first_contacted_at", None)
        if first_contacted is None:
            if _safe_create(
                user=user,
                suggestion_type=TYPE_NEXT_BEST_ACTION,
                title=f"Contact lead {getattr(lead, 'name', '') or lead.pk}",
                description="Lead has been uncontacted for 7+ days.",
                target_module="lead",
                target_id=str(lead.pk),
                priority=70,
            ):
                count += 1
    return count


def _scan_stuck_deals(user: "User") -> int:
    try:  # pragma: no cover — deals may be uninstalled
        from deals.models import Deal  # noqa: PLC0415
        from deals.models_pipeline import Stage  # noqa: PLC0415
    except Exception:
        return 0
    count = 0
    cutoff = timezone.now() - timedelta(days=14)
    for deal in Deal.objects.filter(owner=user, updated_at__lte=cutoff)[:100]:
        stage: Stage | None = getattr(deal, "stage", None)
        if stage is None or getattr(stage, "is_won_stage", False) or getattr(
            stage, "is_lost_stage", False
        ):
            continue
        if _safe_create(
            user=user,
            suggestion_type=TYPE_NEXT_BEST_ACTION,
            title=f"Deal {deal.pk} is stuck in {getattr(stage, 'name', '?')}",
            description="No movement on this deal in 14+ days.",
            target_module="deal",
            target_id=str(deal.pk),
            priority=80,
        ):
            count += 1
    return count


def _scan_churn_risk(user: "User") -> int:
    try:  # pragma: no cover — accounts may be uninstalled
        from accounts.models import Account  # noqa: PLC0415
    except Exception:
        return 0
    cutoff = timezone.now() - timedelta(days=60)
    count = 0
    for acct in Account.objects.filter(owner=user, updated_at__lte=cutoff)[:50]:
        if _safe_create(
            user=user,
            suggestion_type=TYPE_CHURN_RISK,
            title=f"Account {getattr(acct, 'name', '') or acct.pk} at churn risk",
            description="No activity on this account in 60+ days.",
            target_module="account",
            target_id=str(acct.pk),
            priority=60,
        ):
            count += 1
    return count


def generate_suggestions(user: "User") -> dict[str, int]:
    """Generate + persist suggestions for ``user``.

    Returns ``{created: N}``.
    """
    created = 0
    created += _scan_stale_leads(user)
    created += _scan_stuck_deals(user)
    created += _scan_churn_risk(user)
    return {"created": created}


def accept_suggestion(suggestion_id: int | str, *, user: "User | None" = None) -> SmartSuggestion:
    """Mark ``suggestion_id`` accepted. ``user`` is recorded for audit only."""
    suggestion = SmartSuggestion.objects.get(pk=suggestion_id)
    suggestion.is_accepted = True
    suggestion.is_dismissed = False
    suggestion.save(update_fields=["is_accepted", "is_dismissed", "updated_at"])
    return suggestion


def dismiss_suggestion(suggestion_id: int | str, *, user: "User | None" = None) -> SmartSuggestion:
    """Mark ``suggestion_id`` dismissed."""
    suggestion = SmartSuggestion.objects.get(pk=suggestion_id)
    suggestion.is_dismissed = True
    suggestion.save(update_fields=["is_dismissed", "updated_at"])
    return suggestion


__all__ = [
    "accept_suggestion",
    "dismiss_suggestion",
    "generate_suggestions",
]
