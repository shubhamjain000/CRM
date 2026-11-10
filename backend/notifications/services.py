"""Service layer for the notifications app.

This is the canonical interface used by feed signals, productivity tasks, and
approval / file-upload flows. It centralises:

* preference + quiet-hours gating (``should_send``),
* notification row creation + multi-channel dispatch
  (``create_notification``),
* transport stubs for push (``send_push_notification``),
  email (``send_email_notification``), and SMS (``send_sms_notification``),
* unread-count helper (``get_unread_count``).

The transport functions degrade gracefully — push / SMS are no-ops when the
corresponding library or credentials aren't available, and email is dispatched
via a Celery task so the request path never blocks on SMTP.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo

from django.utils import timezone

from .models import (
    Notification,
    NotificationPreference,
    QuietHours,
)

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization, User

log = logging.getLogger(__name__)


###############################################################################
# Verb → notification_type mapping (used to resolve preferences)
###############################################################################


_VERB_TO_TYPE: dict[str, str] = {
    Notification.VERB_MENTIONED: NotificationPreference.TYPE_MENTION,
    Notification.VERB_COMMENTED: NotificationPreference.TYPE_COMMENT,
    Notification.VERB_LIKED: NotificationPreference.TYPE_LIKE,
    Notification.VERB_ASSIGNED: NotificationPreference.TYPE_ASSIGNMENT,
    Notification.VERB_APPROVAL_REQUESTED: NotificationPreference.TYPE_APPROVAL,
    Notification.VERB_APPROVAL_COMPLETED: NotificationPreference.TYPE_APPROVAL,
    Notification.VERB_UPLOADED: NotificationPreference.TYPE_FILE_UPLOAD,
    Notification.VERB_EMAIL_RECEIVED: NotificationPreference.TYPE_EMAIL_RECEIVED,
    Notification.VERB_TASK_DUE: NotificationPreference.TYPE_TASK_DUE,
    Notification.VERB_EVENT_REMINDER: NotificationPreference.TYPE_EVENT_REMINDER,
}


###############################################################################
# Preference + quiet-hours resolution
##############################################################################


def _default_preference(notification_type: str) -> NotificationPreference:
    """Return an in-memory :class:`NotificationPreference` with the app defaults."""
    return NotificationPreference(
        notification_type=notification_type,
        in_app=True,
        email=True,
        push=False,
        sms=False,
        digest_mode=NotificationPreference.DIGEST_IMMEDIATE,
    )


def get_effective_preference(
    *,
    tenant: "Organization",
    user: "User",
    notification_type: str,
) -> NotificationPreference:
    """Return the user's preference row for ``notification_type`` (or defaults)."""
    pref = NotificationPreference.objects.filter(
        tenant=tenant,
        user=user,
        notification_type=notification_type,
    ).first()
    return pref if pref is not None else _default_preference(notification_type)


def _resolve_notification_type(verb: str) -> str | None:
    """Map a :class:`Notification` verb to a :class:`NotificationPreference` type."""
    return _VERB_TO_TYPE.get(verb)


def _now_in_tz(tz_name: str) -> datetime:
    """Return the current datetime in ``tz_name`` (falls back to UTC)."""
    try:
        tz = ZoneInfo(tz_name)
    except Exception:  # pragma: no cover — defensive: bad tz string
        tz = ZoneInfo("UTC")
    return datetime.now(tz)


def _is_in_quiet_window(qh: QuietHours, now: datetime | None = None) -> bool:
    """Return ``True`` if ``now`` falls inside the quiet-hours window.

    Handles windows that wrap midnight (e.g. ``22:00 → 07:00``).
    """
    if not qh.enabled:
        return False
    now = now or _now_in_tz(qh.timezone or "UTC")
    current = now.time()
    start, end = qh.start_time, qh.end_time
    if start == end:
        return False
    if start < end:
        return start <= current < end
    # Wrap-around: e.g. 22:00 → 07:00.
    return current >= start or current < end


def should_send(
    *,
    tenant: "Organization",
    user: "User",
    verb: str,
    channel: str,
) -> bool:
    """Return ``True`` if a notification should be dispatched on ``channel``.

    Considers:

    * :class:`NotificationPreference` toggle for the channel.
    * :class:`QuietHours` window (suppresses email / push / sms; in-app rows
      are always created so the user catches up on return).
    """
    notification_type = _resolve_notification_type(verb)
    if notification_type is None:
        # Unknown verb → allow in-app only.
        return channel == Notification.CHANNEL_IN_APP

    pref = get_effective_preference(
        tenant=tenant, user=user, notification_type=notification_type
    )

    if channel == Notification.CHANNEL_IN_APP:
        return pref.in_app
    if channel == Notification.CHANNEL_EMAIL:
        if not pref.email:
            return False
    elif channel == Notification.CHANNEL_PUSH:
        if not pref.push:
            return False
    elif channel == Notification.CHANNEL_SMS:
        if not pref.sms:
            return False
    else:
        return False

    # Non in-app channels are subject to quiet hours.
    qh = QuietHours.objects.filter(tenant=tenant, user=user).first()
    if qh is not None and _is_in_quiet_window(qh):
        return False
    return True


###############################################################################
# Notification creation + dispatch
##############################################################################


def create_notification(
    *,
    tenant: "Organization",
    actor: "User | None",
    verb: str,
    target_module: str = "",
    target_id: str = "",
    target_name: str = "",
    recipient: "User | None" = None,
    recipient_id: int | None = None,
    data: dict[str, Any] | None = None,
    channel: str = Notification.CHANNEL_IN_APP,
) -> Notification | None:
    """Create + dispatch a notification.

    ``recipient`` *or* ``recipient_id`` must be supplied. The function:

    1. Resolves the recipient's :class:`NotificationPreference` + QuietHours.
    2. Creates an in-app notification row (always — so the recipient catches
       up even when other channels are suppressed).
    3. If ``should_send`` allows email / push / sms, dispatches them via the
       transport stubs.
    4. Broadcasts the in-app row to the recipient's WebSocket group via the
       Channels layer (best-effort — no-op if Channels isn't configured).

    Returns the created :class:`Notification`, or ``None`` if the recipient
    could not be resolved.
    """
    if recipient is None and recipient_id is None:
        raise ValueError("Either recipient or recipient_id must be supplied.")

    from api.models import User

    if recipient is None:
        recipient = User.objects.filter(pk=recipient_id).first()
    if recipient is None:
        log.warning("create_notification: recipient %s not found", recipient_id)
        return None

    payload = data or {}
    payload.setdefault("verb", verb)
    payload.setdefault("target_module", target_module)
    payload.setdefault("target_id", target_id)
    payload.setdefault("target_name", target_name)
    if actor is not None:
        payload.setdefault("actor_id", actor.pk)
        payload.setdefault("actor_name", actor.name or actor.email)

    notification = Notification.objects.create(
        tenant=tenant,
        actor=actor,
        verb=verb,
        target_module=target_module,
        target_id=str(target_id) if target_id else "",
        target_name=target_name,
        recipient=recipient,
        channel=Notification.CHANNEL_IN_APP,
        data=payload,
    )

    # Multi-channel dispatch — each channel gated by should_send.
    if channel != Notification.CHANNEL_IN_APP:
        # The caller asked for a specific non-in-app channel. Always also
        # create the in-app row (above); additionally fire the requested
        # channel if allowed.
        if should_send(
            tenant=tenant, user=recipient, verb=verb, channel=channel
        ):
            _dispatch_channel(
                channel=channel,
                recipient=recipient,
                actor=actor,
                verb=verb,
                target_name=target_name,
                data=payload,
            )
    else:
        # Default: try every channel the user has opted into.
        for ch in (
            Notification.CHANNEL_EMAIL,
            Notification.CHANNEL_PUSH,
            Notification.CHANNEL_SMS,
        ):
            if should_send(tenant=tenant, user=recipient, verb=verb, channel=ch):
                _dispatch_channel(
                    channel=ch,
                    recipient=recipient,
                    actor=actor,
                    verb=verb,
                    target_name=target_name,
                    data=payload,
                )

    # Broadcast to the recipient's WebSocket group (best-effort).
    _broadcast_to_user(recipient.pk, {
        "type": "notification",  # routed to RealtimeConsumer.notification
        "event": "notification",
        "data": _serialize_notification(notification),
    })

    return notification


def _dispatch_channel(
    *,
    channel: str,
    recipient: "User",
    actor: "User | None",
    verb: str,
    target_name: str,
    data: dict[str, Any],
) -> None:
    """Invoke the transport stub for ``channel`` (best-effort)."""
    try:
        if channel == Notification.CHANNEL_EMAIL:
            subject = _email_subject(verb, target_name, actor)
            body = _email_body(verb, target_name, actor, recipient, data)
            send_email_notification(recipient, subject, body)
        elif channel == Notification.CHANNEL_PUSH:
            title = _push_title(verb, actor)
            body = _push_body(verb, target_name, actor)
            send_push_notification(recipient, title, body, data)
        elif channel == Notification.CHANNEL_SMS:
            body = _sms_body(verb, target_name, actor)
            send_sms_notification(recipient, body)
    except Exception:  # pragma: no cover — defensive: never break a notification create
        log.exception("notifications: failed to dispatch channel %s", channel)


###############################################################################
# Transport stubs
##############################################################################


def send_push_notification(
    user: "User",
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
) -> None:
    """Send a Web Push notification via pywebpush.

    Subscription endpoints are read from ``user.profile.preferences["push_subscriptions"]``
    (a list of subscription dicts as exported by the browser's
    ``ServiceWorkerRegistration.pushManager.subscribe``). The function is a
    no-op when:

    * pywebpush isn't installed,
    * the VAPID keys aren't configured (``PUSH_VAPID_PRIVATE_KEY`` env),
    * the user has no subscriptions on file.

    Failures are logged and swallowed so a misconfigured push never breaks the
    in-app notification flow.
    """
    try:
        import os

        from pywebpush import webpush  # type: ignore[import-not-found]
    except Exception:  # pragma: no cover — pywebpush optional
        log.debug("send_push_notification: pywebpush not installed; skipping")
        return

    private_key = os.environ.get("PUSH_VAPID_PRIVATE_KEY", "")
    if not private_key:
        log.debug("send_push_notification: VAPID key not configured; skipping")
        return

    profile = getattr(user, "profile", None)
    if profile is None:
        return
    subs = (profile.preferences or {}).get("push_subscriptions", [])
    if not subs:
        return

    claims = {"sub": f"mailto:{getattr(user, 'email', 'noreply@foundation.local')}"}
    for sub in subs:
        try:
            webpush(
                subscription_info=sub,
                data=__import__("json").dumps(
                    {"title": title, "body": body, "data": data or {}}
                ),
                vapid_private_key=private_key,
                vapid_claims=claims,
            )
        except Exception:  # pragma: no cover — best-effort
            log.exception("send_push_notification: subscription push failed")


def send_email_notification(user: "User", subject: str, body: str) -> None:
    """Send a transactional email via a Celery task.

    Defers the actual SMTP send to a Celery worker so the request path never
    blocks on SMTP. The task is defined in :mod:`notifications.tasks`; this
    function falls back to a synchronous send if Celery isn't available
    (e.g. in unit tests).
    """
    try:
        from .tasks import send_email  # type: ignore[attr-defined]

        send_email.delay(user_id=user.pk, subject=subject, body=body)
        return
    except Exception:  # pragma: no cover — fall back to synchronous send
        pass

    try:
        from django.core.mail import send_mail

        send_mail(
            subject=subject,
            message=body,
            from_email=None,
            recipient_list=[user.email],
            fail_silently=True,
        )
    except Exception:  # pragma: no cover — defensive
        log.exception("send_email_notification: synchronous send failed")


def send_sms_notification(user: "User", body: str) -> None:
    """Send an SMS via Twilio (urgent notifications only).

    The Twilio client is initialised lazily from the ``TWILIO_ACCOUNT_SID`` /
    ``TWILIO_AUTH_TOKEN`` env vars. The recipient phone is read from
    ``user.profile.phone``. The function is a no-op when Twilio isn't
    configured or the user has no phone on file.
    """
    try:
        import os

        from twilio.rest import Client  # type: ignore[import-not-found]
    except Exception:  # pragma: no cover — twilio optional
        log.debug("send_sms_notification: twilio not installed; skipping")
        return

    account_sid = os.environ.get("TWILIO_ACCOUNT_SID", "")
    auth_token = os.environ.get("TWILIO_AUTH_TOKEN", "")
    from_number = os.environ.get("TWILIO_FROM_NUMBER", "")
    if not account_sid or not auth_token or not from_number:
        log.debug("send_sms_notification: Twilio not configured; skipping")
        return

    profile = getattr(user, "profile", None)
    phone = getattr(profile, "phone", "") if profile else ""
    if not phone:
        return

    try:
        client = Client(account_sid, auth_token)
        client.messages.create(body=body, from_=from_number, to=phone)
    except Exception:  # pragma: no cover — defensive
        log.exception("send_sms_notification: twilio send failed")


###############################################################################
# Helpers
##############################################################################


def get_unread_count(user: "User") -> int:
    """Return the count of unread in-app notifications for ``user`` (across tenants)."""
    return Notification.objects.filter(
        recipient=user,
        channel=Notification.CHANNEL_IN_APP,
        read_at__isnull=True,
    ).count()


def mark_all_read(user: "User") -> int:
    """Mark every unread in-app notification for ``user`` as read. Returns the count."""
    return Notification.objects.filter(
        recipient=user,
        read_at__isnull=True,
    ).update(read_at=timezone.now())


def _serialize_notification(notification: Notification) -> dict[str, Any]:
    """JSON-safe representation for the WebSocket broadcast."""
    return {
        "id": notification.pk,
        "verb": notification.verb,
        "actor_id": notification.actor_id,
        "actor_name": (notification.data or {}).get("actor_name", ""),
        "target_module": notification.target_module,
        "target_id": notification.target_id,
        "target_name": notification.target_name,
        "data": notification.data,
        "created_at": notification.created_at.isoformat(),
    }


def _broadcast_to_user(user_id: int, event: dict[str, Any]) -> None:
    """Send ``event`` to the user's WebSocket group via the Channels layer.

    Best-effort: no-op if Channels isn't configured or the channel layer is
    unreachable.
    """
    try:
        from channels.layers import get_channel_layer

        layer = get_channel_layer()
        if layer is None:
            return
        import asyncio

        async def _send() -> None:
            await layer.group_send(f"user:{user_id}", event)

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop is not None:
            # We're inside an async context — schedule the send on the loop.
            loop.create_task(_send())
        else:
            asyncio.run(_send())
    except Exception:  # pragma: no cover — defensive
        log.exception("notifications: failed to broadcast to user %s", user_id)


###############################################################################
# Copy helpers (subject / body / title)
##############################################################################


def _actor_name(actor: "User | None") -> str:
    if actor is None:
        return "Foundation"
    return actor.name or actor.email


def _email_subject(verb: str, target_name: str, actor: "User | None") -> str:
    name = _actor_name(actor)
    if verb == Notification.VERB_MENTIONED:
        return f"{name} mentioned you on {target_name}"
    if verb == Notification.VERB_COMMENTED:
        return f"{name} commented on {target_name}"
    if verb == Notification.VERB_LIKED:
        return f"{name} liked your {target_name}"
    if verb == Notification.VERB_ASSIGNED:
        return f"{name} assigned you to {target_name}"
    if verb == Notification.VERB_APPROVAL_REQUESTED:
        return f"{name} requested your approval on {target_name}"
    if verb == Notification.VERB_APPROVAL_COMPLETED:
        return f"{name} approved {target_name}"
    if verb == Notification.VERB_UPLOADED:
        return f"{name} uploaded a file to {target_name}"
    if verb == Notification.VERB_TASK_DUE:
        return f"Task due: {target_name}"
    if verb == Notification.VERB_EVENT_REMINDER:
        return f"Upcoming event: {target_name}"
    return f"{name} • {verb} • {target_name}"


def _email_body(
    verb: str,
    target_name: str,
    actor: "User | None",
    recipient: "User",
    data: dict[str, Any],
) -> str:
    preview = (data or {}).get("preview", "")
    lines = [
        f"Hi {recipient.name or recipient.email},",
        "",
        _email_subject(verb, target_name, actor),
    ]
    if preview:
        lines.extend(["", preview])
    lines.extend(["", "— Foundation"])
    return "\n".join(lines)


def _push_title(verb: str, actor: "User | None") -> str:
    name = _actor_name(actor)
    if verb in (Notification.VERB_TASK_DUE, Notification.VERB_EVENT_REMINDER):
        return "Foundation reminder"
    return f"{name}"


def _push_body(verb: str, target_name: str, actor: "User | None") -> str:
    name = _actor_name(actor)
    if verb == Notification.VERB_MENTIONED:
        return f"{name} mentioned you on {target_name}"
    if verb == Notification.VERB_COMMENTED:
        return f"{name} commented on {target_name}"
    if verb == Notification.VERB_LIKED:
        return f"{name} liked your {target_name}"
    if verb == Notification.VERB_ASSIGNED:
        return f"{name} assigned you to {target_name}"
    if verb == Notification.VERB_APPROVAL_REQUESTED:
        return f"{name} requested your approval on {target_name}"
    if verb == Notification.VERB_UPLOADED:
        return f"{name} uploaded a file to {target_name}"
    if verb == Notification.VERB_TASK_DUE:
        return f"Task due: {target_name}"
    if verb == Notification.VERB_EVENT_REMINDER:
        return f"Upcoming event: {target_name}"
    return f"{name} • {verb} • {target_name}"


def _sms_body(verb: str, target_name: str, actor: "User | None") -> str:
    name = _actor_name(actor)
    return f"Foundation: {_push_body(verb, target_name, actor)}".replace(name, name[:24])


__all__ = [
    "create_notification",
    "get_effective_preference",
    "get_unread_count",
    "mark_all_read",
    "send_email_notification",
    "send_push_notification",
    "send_sms_notification",
    "should_send",
]
