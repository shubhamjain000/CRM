"""Pipeline alerting — Celery tasks + Deal amount-drop signal (Phase 8).

Three proactive-monitoring entry points:

* :func:`check_stuck_deals` — Celery beat (daily 09:00 UTC). For every
  tenant, finds deals whose current stage has a ``business_days_limit``
  and the deal has been in the stage past the limit. Dispatches an in-app
  notification to the deal owner + every tenant admin (a tenant-scoped
  manager proxy — the platform has no ``User.manager`` FK yet).
* :func:`check_overdue_deals` — Celery beat (daily 09:00 UTC). Finds
  deals whose ``close_date`` is in the past while the stage is still
  open. Same notification routing as :func:`check_stuck_deals`.
* :func:`check_amount_drops` — connected to :class:`deals.models.Deal`
  ``post_save`` by :mod:`deals.apps.DealsConfig.ready`. When a deal's
  ``amount`` drops by more than 50 % in a single save, dispatches a
  notification to tenant admins. A ``pre_save`` handler stashes the prior
  amount on the instance so ``post_save`` can compute the delta safely
  (the DB row already reflects the new value when ``post_save`` fires).

All three use :func:`notifications.services.create_notification` so the
in-app row is always written and the email/push/SMS channels are gated by
the recipient's :class:`notifications.models.NotificationPreference` /
:class:`QuietHours`.
"""

from __future__ import annotations

import logging
from typing import Any

from celery import shared_task
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver
from django.utils import timezone

from api.managers import tenant_context
from api.models import Organization, TenantMembership, User
from deals.models import Deal
from deals.services import PipelineService

log = logging.getLogger(__name__)


###############################################################################
# Helpers
###############################################################################


def _tenant_admins(tenant: Organization) -> list[User]:
    """Return users with an admin/owner role in ``tenant``.

    A user is treated as a tenant admin when their role name (lowercased)
    is in ``{"admin", "owner"}`` *or* their role grants the ``org.admin``
    permission. Used as a manager proxy until a real org-chart ships.
    """
    from api.permissions import is_admin_role

    memberships = (
        TenantMembership.objects.filter(tenant=tenant, is_active=True)
        .select_related("role", "user")
        .iterator(chunk_size=200)
    )
    out: list[User] = []
    seen: set[int] = set()
    for m in memberships:
        if m.user_id in seen:
            continue
        if is_admin_role(m.role):
            out.append(m.user)
            seen.add(m.user_id)
    return out


def _dispatch_deal_alert(
    *,
    deal: Deal,
    verb: str,
    title: str,
    body: str,
    metadata: dict[str, Any] | None = None,
) -> int:
    """Notify the deal owner + tenant admins of a pipeline alert.

    Returns the number of notifications created (0 if the deal has no
    owner or no admins). Failures are logged but never re-raised — the
    alert task is best-effort and should never break the daily sweep.
    """
    from notifications.services import create_notification

    recipients: list[User] = []
    if deal.owner_id:
        owner = deal.owner
        if owner is not None:
            recipients.append(owner)
    admins = _tenant_admins(deal.tenant)
    for admin in admins:
        if admin.pk not in {r.pk for r in recipients}:
            recipients.append(admin)

    sent = 0
    for recipient in recipients:
        try:
            create_notification(
                tenant=deal.tenant,
                actor=None,  # system-initiated
                verb=verb,
                target_module="deal",
                target_id=str(deal.pk),
                target_name=deal.name,
                recipient=recipient,
                data={
                    "title": title,
                    "body": body,
                    "deal_id": deal.pk,
                    "deal_name": deal.name,
                    "pipeline_id": deal.pipeline_id,
                    "stage_id": deal.stage_id,
                    "stage_name": deal.stage.name if deal.stage_id else "",
                    "amount": str(deal.amount or 0),
                    "currency": deal.currency,
                    "owner_id": deal.owner_id,
                    "owner_email": deal.owner.email if deal.owner_id else "",
                    **(metadata or {}),
                },
            )
            sent += 1
        except Exception:  # pragma: no cover — defensive
            log.exception(
                "dispatch_deal_alert: failed to notify recipient %s for deal %s",
                recipient.pk, deal.pk,
            )
    return sent


###############################################################################
# Stuck deals
###############################################################################


@shared_task(name="deals.check_stuck_deals")
def check_stuck_deals() -> dict[str, Any]:
    """Daily sweep — find deals that have overstayed their stage limit.

    For each active tenant:

    1. Find stages with ``business_days_limit`` set.
    2. Find deals currently in those stages whose ``days_in_stage``
       (computed by :meth:`PipelineService.check_stage_limits`) exceeds
       the limit.
    3. Dispatch a notification (verb ``task_due`` — re-used for "needs
       action" semantics; the frontend bell treats it as a reminder).

    Returns a summary dict for the Celery log line.
    """
    summary: dict[str, Any] = {
        "tenants_processed": 0,
        "stuck_deals": 0,
        "notifications_sent": 0,
        "errors": [],
    }
    service = PipelineService()

    for org in Organization.objects.filter(is_active=True).iterator(chunk_size=200):
        with tenant_context(org):
            summary["tenants_processed"] += 1
            # Stages with a business_days_limit + their current deal counts.
            stuck_qs = (
                Deal.objects.filter(
                    tenant=org,
                    deleted_at__isnull=True,
                    stage__business_days_limit__isnull=False,
                )
                .select_related("stage", "pipeline", "owner", "tenant")
            )
            for deal in stuck_qs.iterator(chunk_size=200):
                try:
                    report = service.check_stage_limits(deal)
                    if not report.stuck:
                        continue
                    summary["stuck_deals"] += 1
                    title = f"Deal '{deal.name}' is stuck in {deal.stage.name}"
                    body = (
                        f"Stuck for {report.days_in_stage} business days "
                        f"(limit: {report.limit}). Owner: "
                        f"{deal.owner.email if deal.owner_id else 'unassigned'}."
                    )
                    sent = _dispatch_deal_alert(
                        deal=deal,
                        verb="task_due",
                        title=title,
                        body=body,
                        metadata={
                            "alert_type": "stuck_deal",
                            "days_in_stage": report.days_in_stage,
                            "stage_limit": report.limit,
                        },
                    )
                    summary["notifications_sent"] += sent
                except Exception as exc:  # pragma: no cover — defensive
                    log.exception("check_stuck_deals: failed on deal %s", deal.pk)
                    summary["errors"].append({"deal_id": deal.pk, "error": str(exc)})

    log.info(
        "check_stuck_deals: tenants=%s stuck=%s sent=%s",
        summary["tenants_processed"], summary["stuck_deals"], summary["notifications_sent"],
    )
    return summary


###############################################################################
# Overdue deals
###############################################################################


@shared_task(name="deals.check_overdue_deals")
def check_overdue_deals() -> dict[str, Any]:
    """Daily sweep — find deals whose ``close_date`` passed while still open.

    A deal is overdue when:

    * ``close_date`` is not null and is strictly less than today; AND
    * the deal's current stage is **not** a won/lost terminal stage.

    The notification routing mirrors :func:`check_stuck_deals`.
    """
    today = timezone.now().date()
    summary: dict[str, Any] = {
        "tenants_processed": 0,
        "overdue_deals": 0,
        "notifications_sent": 0,
        "errors": [],
    }

    for org in Organization.objects.filter(is_active=True).iterator(chunk_size=200):
        with tenant_context(org):
            summary["tenants_processed"] += 1
            # Annotate the deal's stage flags so we can filter open-in-DB.
            # is_open isn't a column — it's a Python property — so we use
            # the stage flags directly.
            overdue_qs = (
                Deal.objects.filter(
                    tenant=org,
                    deleted_at__isnull=True,
                    close_date__lt=today,
                )
                .exclude(stage__is_won_stage=True)
                .exclude(stage__is_lost_stage=True)
                .select_related("stage", "pipeline", "owner", "tenant")
            )
            for deal in overdue_qs.iterator(chunk_size=200):
                try:
                    summary["overdue_deals"] += 1
                    title = f"Deal '{deal.name}' is overdue"
                    body = (
                        f"Close date {deal.close_date.isoformat()} has passed "
                        f"but the deal is still in '{deal.stage.name}'. "
                        f"Owner: {deal.owner.email if deal.owner_id else 'unassigned'}."
                    )
                    sent = _dispatch_deal_alert(
                        deal=deal,
                        verb="task_due",
                        title=title,
                        body=body,
                        metadata={
                            "alert_type": "overdue_deal",
                            "close_date": deal.close_date.isoformat(),
                        },
                    )
                    summary["notifications_sent"] += sent
                except Exception as exc:  # pragma: no cover — defensive
                    log.exception("check_overdue_deals: failed on deal %s", deal.pk)
                    summary["errors"].append({"deal_id": deal.pk, "error": str(exc)})

    log.info(
        "check_overdue_deals: tenants=%s overdue=%s sent=%s",
        summary["tenants_processed"], summary["overdue_deals"], summary["notifications_sent"],
    )
    return summary


###############################################################################
# Amount-drop signal
###############################################################################


@receiver(pre_save, sender=Deal)
def deal_pre_save_capture_amount(
    sender: type,
    instance: Deal,
    raw: bool,
    **kwargs: Any,
) -> None:
    """Stash the prior ``amount`` on the instance for ``post_save`` comparison.

    Skipped for raw loads and brand-new rows.
    """
    if raw or instance.pk is None:
        instance._prior_amount = None  # type: ignore[attr-defined]
        return
    try:
        prior = Deal.all_objects.filter(pk=instance.pk).only("amount").first()
    except Deal.DoesNotExist:  # pragma: no cover — defensive
        prior = None
    instance._prior_amount = prior.amount if prior else None  # type: ignore[attr-defined]


@receiver(post_save, sender=Deal)
def deal_post_save_check_amount_drop(
    sender: type,
    instance: Deal,
    created: bool,
    raw: bool,
    **kwargs: Any,
) -> None:
    """Notify tenant admins when a deal's ``amount`` drops > 50 % in one save.

    The threshold is intentionally aggressive — a 50 %+ drop usually means
    a re-scope or a lost sub-component, both of which the manager needs to
    see. Smaller fluctuations are normal pipeline churn and are ignored.

    Skipped for:

    * raw loads + creates (no prior value to compare against).
    * soft-delete / restore saves (``update_fields`` is ``{deleted_at,
      updated_at}``).
    * deals without a tenant (system / fixture loads).
    """
    if raw or created or instance.tenant_id is None:
        return
    update_fields = kwargs.get("update_fields")
    if update_fields and "amount" not in update_fields:
        return

    prior = getattr(instance, "_prior_amount", None)
    if prior is None:
        return
    # Both are Decimal — comparison is exact.
    if prior <= 0:
        return
    new_amount = instance.amount or 0
    if new_amount >= prior:
        return
    drop_ratio = (prior - new_amount) / prior
    if drop_ratio <= 0.5:
        return

    try:
        _dispatch_deal_alert(
            deal=instance,
            verb="updated",
            title=f"Deal '{instance.name}' amount dropped {int(drop_ratio * 100)}%",
            body=(
                f"Amount dropped from {prior} {instance.currency} to "
                f"{new_amount} {instance.currency} (≥50% decrease). "
                "Review the deal for re-scope or discount approval."
            ),
            metadata={
                "alert_type": "amount_drop",
                "prior_amount": str(prior),
                "new_amount": str(new_amount),
                "drop_ratio": round(float(drop_ratio), 4),
            },
        )
    except Exception:  # pragma: no cover — defensive: never break a save
        log.exception(
            "deal_post_save_check_amount_drop: failed for deal %s", instance.pk
        )


__all__ = [
    "check_overdue_deals",
    "check_stuck_deals",
    "deal_post_save_check_amount_drop",
    "deal_pre_save_capture_amount",
]
