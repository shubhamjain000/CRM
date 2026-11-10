"""Celery tasks for the notifications app.

Currently only the async email-sending task. SMS + push are dispatched
synchronously (and best-effort) by :func:`notifications.services.send_sms_notification`
/ :func:`notifications.services.send_push_notification` because they are
typically much faster than SMTP.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from celery import shared_task
from django.core.mail import send_mail

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import User

log = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def send_email(self: Any, *, user_id: int, subject: str, body: str) -> None:
    """Send a transactional email to ``user_id`` via Django's SMTP backend."""
    from api.models import User

    user = User.objects.filter(pk=user_id).first()
    if user is None:
        log.warning("notifications.send_email: user %s not found", user_id)
        return
    try:
        send_mail(
            subject=subject,
            message=body,
            from_email=None,
            recipient_list=[user.email],
            fail_silently=False,
        )
    except Exception as exc:  # pragma: no cover — defensive
        log.exception("notifications.send_email: SMTP send failed")
        raise self.retry(exc=exc, countdown=60)


@shared_task
def send_daily_digest() -> int:
    """Daily digest — for each user with digest_mode=daily, email them their
    unread in-app notifications from the last 24h.

    Returns the number of digests sent. This task is wired into the Celery
    beat schedule by Phase 7 (config/settings.py).
    """
    from datetime import timedelta

    from django.utils import timezone

    from .models import Notification, NotificationPreference
    from .services import send_email_notification

    cutoff = timezone.now() - timedelta(days=1)
    sent = 0
    prefs = NotificationPreference.objects.filter(
        digest_mode=NotificationPreference.DIGEST_DAILY,
        email=True,
    ).select_related("user", "tenant")
    for pref in prefs:
        if pref.user is None:
            continue
        unread = Notification.objects.filter(
            recipient=pref.user,
            channel=Notification.CHANNEL_IN_APP,
            read_at__isnull=True,
            created_at__gte=cutoff,
        ).count()
        if unread == 0:
            continue
        subject = f"Your daily Foundation digest — {unread} new notification{'s' if unread != 1 else ''}"
        body = (
            f"Hi {pref.user.name or pref.user.email},\n\n"
            f"You have {unread} unread notification(s) from the last 24 hours.\n\n"
            "— Foundation"
        )
        send_email_notification(pref.user, subject, body)
        sent += 1
    return sent


__all__ = ["send_daily_digest", "send_email"]
