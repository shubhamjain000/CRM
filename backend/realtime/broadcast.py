"""Broadcast helpers for the realtime layer.

These thin wrappers let the rest of the codebase push events into WebSocket
groups without having to import / understand the Channels layer API. They're
safe to call from synchronous Django code (signals, viewsets, Celery tasks).

Three group namespaces are used:

* ``user:<user_id>`` — only the supplied user receives the event. Used for
  notifications, private mentions, and personal task assignments.
* ``org:<tenant_id>`` — every online member of the tenant receives the event.
  Used for org-wide presence updates and feed posts.
* ``record:<module>:<record_id>`` — only users currently viewing the supplied
  record receive the event. Used for field-level diff broadcasts, cursor
  updates, and typing indicators. Users opt into a record's group by sending
  ``{"type": "subscribe_record", "module": "...", "record_id": "..."}`` over
  the socket (handled by :class:`realtime.consumers.RealtimeConsumer`).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

log = logging.getLogger(__name__)


def _channel_layer() -> Any:
    """Return the configured channel layer (or ``None`` if unavailable)."""
    try:
        from channels.layers import get_channel_layer

        return get_channel_layer()
    except Exception:  # pragma: no cover — defensive
        return None


def _send_async(group: str, event: dict[str, Any]) -> None:
    """Best-effort ``group_send`` from a synchronous context.

    Detects whether we're already inside a running event loop and, if so,
    schedules the send on that loop instead of starting a new one (which
    would crash with ``RuntimeError: This event loop is already running``).
    """
    layer = _channel_layer()
    if layer is None:
        return

    async def _send() -> None:
        await layer.group_send(group, event)

    try:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop is not None:
            loop.create_task(_send())
        else:
            asyncio.run(_send())
    except Exception:  # pragma: no cover — defensive
        log.exception("realtime.broadcast: failed to send to group %s", group)


async def _send_async_native(group: str, event: dict[str, Any]) -> None:
    """Best-effort ``group_send`` from inside an async context (consumer)."""
    layer = _channel_layer()
    if layer is None:
        return
    try:
        await layer.group_send(group, event)
    except Exception:  # pragma: no cover — defensive
        log.exception("realtime.broadcast: failed to send to group %s", group)


def _event(event_type: str, data: dict[str, Any], *, kind: str | None = None) -> dict[str, Any]:
    """Build a Channels event envelope.

    The ``type`` field is the *handler* name on the consumer (``record_updated``
    → ``RealtimeConsumer.record_updated``); the ``event`` field is the
    *event name* the client sees (used for routing in the frontend).
    """
    handler = kind or event_type
    return {"type": handler, "event": event_type, "data": data}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def broadcast_to_user(user_id: int | str, event: str, data: dict[str, Any]) -> None:
    """Broadcast ``event`` + ``data`` to every socket owned by ``user_id``."""
    _send_async(f"user:{user_id}", _event(event, data))


def broadcast_to_org(org_id: int | str, event: str, data: dict[str, Any]) -> None:
    """Broadcast ``event`` + ``data`` to every socket owned by a member of ``org_id``."""
    _send_async(f"org:{org_id}", _event(event, data))


def broadcast_to_record(
    module: str,
    record_id: str,
    event: str,
    data: dict[str, Any],
) -> None:
    """Broadcast ``event`` + ``data`` to every socket currently subscribed to the record."""
    _send_async(f"record:{module}:{record_id}", _event(event, data))


# ---------------------------------------------------------------------------
# Convenience event-specific helpers (used by the rest of the codebase).
# ---------------------------------------------------------------------------


def push_record_created(
    *, org_id: int | str, module: str, record_id: str, record: dict[str, Any]
) -> None:
    """Notify the org that a record was created."""
    broadcast_to_org(
        org_id,
        "record_created",
        {"module": module, "record_id": str(record_id), "record": record},
    )


def push_record_updated(
    *,
    org_id: int | str,
    module: str,
    record_id: str,
    changes: dict[str, Any],
    actor_id: int | str | None = None,
) -> None:
    """Notify the org (and the record group) of a record update.

    ``changes`` is a ``{field: {old, new}}`` dict produced by the diff
    helper on the model's signal.
    """
    payload = {
        "module": module,
        "record_id": str(record_id),
        "changes": changes,
        "actor_id": actor_id,
    }
    broadcast_to_org(org_id, "record_updated", payload)
    broadcast_to_record(module, str(record_id), "record_updated", payload)


def push_record_deleted(
    *,
    org_id: int | str,
    module: str,
    record_id: str,
    actor_id: int | str | None = None,
) -> None:
    """Notify the org that a record was deleted."""
    payload = {"module": module, "record_id": str(record_id), "actor_id": actor_id}
    broadcast_to_org(org_id, "record_deleted", payload)
    broadcast_to_record(module, str(record_id), "record_deleted", payload)


def push_notification(*, user_id: int | str, notification: dict[str, Any]) -> None:
    """Push a single notification payload to the recipient's socket group."""
    broadcast_to_user(user_id, "notification", notification)


def push_mention(
    *, user_id: int | str, actor_id: int | str | None, target_module: str, target_id: str
) -> None:
    """Push a mention event (lighter-weight than a full notification)."""
    broadcast_to_user(
        user_id,
        "mention",
        {"actor_id": actor_id, "target_module": target_module, "target_id": str(target_id)},
    )


def push_task_assigned(
    *, user_id: int | str, task_id: int | str, actor_id: int | str | None, title: str
) -> None:
    """Push a task-assignment event to the new assignee."""
    broadcast_to_user(
        user_id,
        "task_assigned",
        {"task_id": task_id, "actor_id": actor_id, "title": title},
    )


def push_approval_requested(
    *, user_id: int | str, approval_id: int | str, target_name: str
) -> None:
    """Push an approval-requested event to the approver."""
    broadcast_to_user(
        user_id,
        "approval_requested",
        {"approval_id": approval_id, "target_name": target_name},
    )


def push_approval_completed(
    *, actor_id: int | str, approval_id: int | str, decision: str
) -> None:
    """Push an approval-completed event to the org."""
    # The approval requester may be in any org the actor belongs to — fan out
    # via the org group of the actor (the most common case in single-tenant
    # deployments). Callers can override by calling broadcast_to_user directly.
    broadcast_to_org(
        actor_id,
        "approval_completed",
        {"approval_id": approval_id, "decision": decision, "actor_id": actor_id},
    )


def push_file_uploaded(
    *, org_id: int | str, file_id: int | str, filename: str, actor_id: int | str | None
) -> None:
    """Push a file-uploaded event to the org."""
    broadcast_to_org(
        org_id,
        "file_uploaded",
        {"file_id": file_id, "filename": filename, "actor_id": actor_id},
    )


def push_email_received(
    *, user_id: int | str, thread_id: int | str, subject: str, from_address: str
) -> None:
    """Push an email-received event to the mailbox owner."""
    broadcast_to_user(
        user_id,
        "email_received",
        {
            "thread_id": thread_id,
            "subject": subject,
            "from_address": from_address,
        },
    )


def push_chat_message_received(
    *, user_id: int | str, channel_id: int | str, message: dict[str, Any]
) -> None:
    """Push a chat-message-received event to the recipient."""
    broadcast_to_user(
        user_id,
        "chat_message_received",
        {"channel_id": channel_id, "message": message},
    )


def push_presence_update(
    *, org_id: int | str, user_id: int | str, status: str, is_online: bool
) -> None:
    """Push a presence-update event to the org."""
    broadcast_to_org(
        org_id,
        "presence_update",
        {"user_id": user_id, "status": status, "is_online": is_online},
    )


def push_cursor_update(
    *,
    module: str,
    record_id: str,
    user_id: int | str,
    field: str,
    position: int,
    color: str,
) -> None:
    """Push a live-cursor update to the record's subscriber group."""
    broadcast_to_record(
        module,
        str(record_id),
        "cursor_update",
        {
            "user_id": user_id,
            "field": field,
            "position": position,
            "color": color,
        },
    )


def push_typing_indicator(
    *,
    module: str,
    record_id: str,
    user_id: int | str,
    is_typing: bool,
) -> None:
    """Push a typing-indicator event to the record's subscriber group."""
    broadcast_to_record(
        module,
        str(record_id),
        "typing_indicator",
        {"user_id": user_id, "is_typing": is_typing},
    )


__all__ = [
    "_send_async_native",
    "broadcast_to_org",
    "broadcast_to_record",
    "broadcast_to_user",
    "push_approval_completed",
    "push_approval_requested",
    "push_chat_message_received",
    "push_cursor_update",
    "push_email_received",
    "push_file_uploaded",
    "push_mention",
    "push_notification",
    "push_presence_update",
    "push_record_created",
    "push_record_deleted",
    "push_record_updated",
    "push_task_assigned",
    "push_typing_indicator",
]
