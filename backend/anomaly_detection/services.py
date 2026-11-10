"""Service layer for the anomaly_detection app.

* :func:`scan_anomalies` — hourly Celery-beat entry. Walks every tenant
  looking for: deal-amount drops (close_probability fall > 20% via the
  deal_prediction app), rep-activity drops (no calls logged in 7 days),
  lead-response-time breaches (> 24h to first contact). Creates an
  :class:`Anomaly` row per detected signal; high / critical severities
  fire a notification via the :mod:`notifications` app (lazy import).
* :func:`acknowledge_anomaly` / :func:`resolve_anomaly` — state
  transitions on an existing row.
* :func:`get_trends` — per-anomaly-type counts grouped by severity for
  the last ``days`` days.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import TYPE_CHECKING, Any

from django.db.models import Count, Q
from django.utils import timezone

from .models import (
    ANOMALY_DEAL_AMOUNT_DROP,
    ANOMALY_LEAD_RESPONSE_SLOW,
    ANOMALY_REP_ACTIVITY_DROP,
    Anomaly,
    SEVERITY_CRITICAL,
    SEVERITY_HIGH,
    SEVERITY_LOW,
    SEVERITY_MEDIUM,
    STATUS_ACKNOWLEDGED,
    STATUS_RESOLVED,
)

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization, User

log = logging.getLogger(__name__)

URGENT_SEVERITIES = (SEVERITY_HIGH, SEVERITY_CRITICAL)


def _notify(tenant: "Organization", severity: str, description: str) -> None:
    """Fire a notification for high / critical anomalies (best-effort)."""
    if severity not in URGENT_SEVERITIES:
        return
    try:  # pragma: no cover — notifications app may be uninstalled / mocked
        from notifications.services import create_notification  # noqa: PLC0415

        create_notification(
            tenant=tenant,
            recipient=None,  # broadcast to tenant admins
            title=f"Anomaly detected — {severity}",
            body=description,
            category="anomaly",
        )
    except Exception:
        log.debug("notify: notifications app unavailable — skipping")


def _create_anomaly(
    tenant: "Organization",
    *,
    record_type: str,
    record_id: str,
    anomaly_type: str,
    severity: str,
    description: str,
) -> Anomaly | None:
    """Create an Anomaly row if one is not already open for the same target."""
    existing = Anomaly.objects.filter(
        tenant=tenant,
        record_type=record_type,
        record_id=record_id,
        anomaly_type=anomaly_type,
        status="open",
    ).exists()
    if existing:
        return None
    anomaly = Anomaly.objects.create(
        tenant=tenant,
        record_type=record_type,
        record_id=str(record_id),
        anomaly_type=anomaly_type,
        severity=severity,
        description=description,
    )
    _notify(tenant, severity, description)
    return anomaly


def _scan_deal_amount_drops(tenant: "Organization") -> int:
    try:  # pragma: no cover — deal_prediction may be uninstalled
        from deal_prediction.services import get_at_risk  # noqa: PLC0415
    except Exception:
        return 0
    count = 0
    for row in get_at_risk(tenant=tenant, limit=100):
        prev = (row.factors or {}).get("previous_probability") or 0
        cur = row.close_probability
        drop_pct = abs(prev - cur) / prev if prev > 0 else 0
        if drop_pct >= 0.4:
            severity = SEVERITY_CRITICAL
        elif drop_pct >= 0.3:
            severity = SEVERITY_HIGH
        else:
            severity = SEVERITY_MEDIUM
        if _create_anomaly(
            tenant,
            record_type="deal",
            record_id=row.deal_id,
            anomaly_type=ANOMALY_DEAL_AMOUNT_DROP,
            severity=severity,
            description=(
                f"Deal {row.deal_id} close-probability dropped "
                f"{prev:.0%} → {cur:.0%} ({drop_pct:.0%})."
            ),
        ):
            count += 1
    return count


def _scan_rep_activity_drops(tenant: "Organization") -> int:
    try:  # pragma: no cover — calls may be uninstalled
        from calls.models import Call  # noqa: PLC0415
    except Exception:
        return 0
    from api.models import TenantMembership  # noqa: PLC0415

    week_ago = timezone.now() - timedelta(days=7)
    count = 0
    for membership in TenantMembership.objects.filter(
        tenant=tenant, is_active=True
    ).select_related("user"):
        recent = Call.objects.filter(
            tenant=tenant, created_by=membership.user, started_at__gte=week_ago
        ).count()
        if recent == 0:
            if _create_anomaly(
                tenant,
                record_type="user",
                record_id=str(membership.user_id),
                anomaly_type=ANOMALY_REP_ACTIVITY_DROP,
                severity=SEVERITY_MEDIUM,
                description=(
                    f"Rep {membership.user.email} has logged 0 calls in the last 7 days."
                ),
            ):
                count += 1
    return count


def _scan_lead_response_time(tenant: "Organization") -> int:
    try:  # pragma: no cover — leads may be uninstalled
        from leads.models import Lead  # noqa: PLC0415
    except Exception:
        return 0
    cutoff = timezone.now() - timedelta(hours=24)
    count = 0
    for lead in Lead.objects.filter(
        tenant=tenant,
        created_at__lte=cutoff,
    ).exclude(owner__isnull=True)[:200]:
        first_activity = getattr(lead, "first_contacted_at", None)
        if first_activity is None:
            if _create_anomaly(
                tenant,
                record_type="lead",
                record_id=str(lead.pk),
                anomaly_type=ANOMALY_LEAD_RESPONSE_SLOW,
                severity=SEVERITY_HIGH,
                description=(
                    f"Lead {lead.pk} created > 24h ago with no first-contact recorded."
                ),
            ):
                count += 1
    return count


def scan_anomalies(tenant: "Organization | None" = None) -> dict[str, int]:
    """Hourly Celery-beat task body. Scans one tenant (or every tenant)."""
    from api.models import Organization  # noqa: PLC0415

    tenants = [tenant] if tenant is not None else list(Organization.objects.all())
    created = 0
    for t in tenants:
        try:
            created += _scan_deal_amount_drops(t)
            created += _scan_rep_activity_drops(t)
            created += _scan_lead_response_time(t)
        except Exception:  # pragma: no cover — defensive
            log.exception("scan_anomalies: tenant %s failed", t.pk)
    return {"created": created}


def acknowledge_anomaly(anomaly: Anomaly, *, user: "User") -> Anomaly:
    """Mark ``anomaly`` acknowledged by ``user`` (status → acknowledged)."""
    anomaly.acknowledged_by = user
    anomaly.acknowledged_at = timezone.now()
    anomaly.status = STATUS_ACKNOWLEDGED
    anomaly.save(update_fields=["acknowledged_by", "acknowledged_at", "status", "updated_at"])
    return anomaly


def resolve_anomaly(anomaly: Anomaly, *, user: "User | None" = None) -> Anomaly:
    """Mark ``anomaly`` resolved. ``user`` is recorded as the acknowledger
    if not already set."""
    if anomaly.acknowledged_by is None and user is not None:
        anomaly.acknowledged_by = user
        anomaly.acknowledged_at = timezone.now()
    anomaly.status = STATUS_RESOLVED
    anomaly.save(update_fields=["acknowledged_by", "acknowledged_at", "status", "updated_at"])
    return anomaly


def get_trends(
    tenant: "Organization | None" = None, *, days: int = 30
) -> list[dict[str, Any]]:
    """Return ``[{anomaly_type, severity, count}]`` for the last ``days`` days."""
    since = timezone.now() - timedelta(days=days)
    qs = Anomaly.objects.filter(detected_at__gte=since)
    if tenant is not None:
        qs = qs.filter(tenant=tenant)
    qs = qs.values("anomaly_type", "severity").annotate(count=Count("id")).order_by(
        "anomaly_type", "severity"
    )
    return list(qs)


__all__ = [
    "acknowledge_anomaly",
    "get_trends",
    "resolve_anomaly",
    "scan_anomalies",
]
