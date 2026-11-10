"""Tenant-aware Celery tasks.

Every task that operates on tenant-scoped data accepts ``tenant_id`` and binds
the tenant via :func:`api.managers.tenant_context` inside the worker body. This
mirrors how :class:`api.middleware.TenantMiddleware` binds the tenant on the
web thread.
"""

from __future__ import annotations

import logging
from typing import Any

from celery import shared_task
from django.conf import settings
from django.core.mail import send_mail
from django.db.models import Q
from django.utils import timezone

from .managers import tenant_context
from .models import ApiKey, Device, MagicLink, Organization, User
from .utils import audit_log, build_magic_link_url

log = logging.getLogger(__name__)


###############################################################################
# Auth & notifications
###############################################################################


@shared_task(bind=True, name="api.send_magic_link")
def send_magic_link(self: Any, tenant_id: int | None, email: str, token: str) -> dict[str, Any]:
    """Email a magic-link token to ``email``.

    ``tenant_id`` is accepted for symmetry with the other tasks; if a tenant is
    resolved, the link is logged in that tenant's audit trail.
    """
    tenant = Organization.objects.filter(pk=tenant_id).first() if tenant_id else None
    link_url = build_magic_link_url(token)
    subject = "Your Foundation sign-in link"
    plain = f"Click the link below to sign in. It expires in 10 minutes.\n\n{link_url}\n"
    try:
        send_mail(
            subject=subject,
            message=plain,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[email],
            fail_silently=False,
        )
    except Exception as exc:  # pragma: no cover — depends on SMTP config
        log.warning("send_magic_link failed for %s: %s", email, exc)
        return {"ok": False, "error": str(exc)}

    with tenant_context(tenant):
        audit_log(
            actor=None,
            action="magic_link.sent",
            target=None,
            request=None,
            metadata={"email": email, "tenant_id": tenant_id},
            tenant=tenant,
        )
    return {"ok": True}


@shared_task(bind=True, name="api.send_suspicious_login_alert")
def send_suspicious_login_alert(
    self: Any, tenant_id: int | None, user_id: int, ip: str | None
) -> dict[str, Any]:
    """Email a user about a suspicious login attempt from ``ip``."""
    tenant = Organization.objects.filter(pk=tenant_id).first() if tenant_id else None
    user = User.objects.filter(pk=user_id).first()
    if not user:
        return {"ok": False, "error": "user_not_found"}

    subject = "[Security] Suspicious login attempt on your account"
    body = (
        f"We detected a login attempt on your account from {ip or 'an unknown IP'}.\n"
        "If this was you, you can ignore this message. "
        "If not, please contact your organization administrator.\n"
    )
    try:
        send_mail(
            subject=subject,
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=False,
        )
    except Exception as exc:  # pragma: no cover
        log.warning("send_suspicious_login_alert failed for %s: %s", user.email, exc)
        return {"ok": False, "error": str(exc)}

    with tenant_context(tenant):
        audit_log(
            actor=user,
            action="login.suspicious_alert_sent",
            target=user,
            request=None,
            metadata={"ip": ip, "tenant_id": tenant_id},
            tenant=tenant,
        )
    return {"ok": True}


###############################################################################
# Maintenance
###############################################################################


@shared_task(name="api.cleanup_expired_sessions")
def cleanup_expired_sessions() -> dict[str, Any]:
    """Delete expired / consumed magic links and stale device records.

    Runs unscoped (these tables are either global or use timestamp indices).
    """
    now = timezone.now()
    expired_count, _ = MagicLink.objects.filter(Q(expires_at__lt=now)).delete()
    used_count, _ = MagicLink.objects.filter(used=True).delete()
    # Devices inactive for > 90 days are removed.
    cutoff = now - timezone.timedelta(days=90)
    device_deleted, _ = Device.objects.filter(last_seen__lt=cutoff).delete()
    return {
        "magic_expired_deleted": expired_count,
        "magic_used_deleted": used_count,
        "devices_deleted": device_deleted,
    }


@shared_task(name="api.rotate_api_keys")
def rotate_api_keys() -> dict[str, Any]:
    """Delete API keys past their expiry; flag those nearing expiry.

    Iterates per-tenant so RLS / audit logs are scoped correctly.
    """
    now = timezone.now()
    soon = now + timezone.timedelta(days=7)
    expired_count = 0
    expiring_soon: list[dict[str, Any]] = []

    # Unscoped traversal; we set tenant_context per key for the audit log.
    for key in ApiKey.objects.select_related("tenant", "user").filter(expires_at__isnull=False):
        with tenant_context(key.tenant):
            if key.expires_at and key.expires_at <= now:
                audit_log(
                    actor=key.user,
                    action="api_key.expired",
                    target=key,
                    request=None,
                    tenant=key.tenant,
                )
                key.delete()
                expired_count += 1
            elif key.expires_at and key.expires_at <= soon:
                expiring_soon.append(
                    {"id": key.pk, "name": key.name, "expires_at": key.expires_at.isoformat()}
                )
    return {"expired": expired_count, "expiring_soon": expiring_soon}
