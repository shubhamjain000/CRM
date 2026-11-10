"""WebSocket consumer for the realtime layer.

The consumer is a single :class:`RealtimeConsumer` that handles every
real-time event in the CRM. Auth is via JWT (query string or subprotocol —
see :mod:`realtime.auth`).

Connection lifecycle
--------------------
1. ``connect`` resolves the JWT, looks up the user, enforces the per-user
   concurrent-connection limit (5 sockets), and joins the user + org groups.
2. ``receive_json`` dispatches inbound client messages: ``ping`` (heartbeat),
   ``set_status``, ``set_viewing``, ``cursor_update``, ``typing_indicator``,
   ``subscribe_record``, ``unsubscribe_record``.
3. ``disconnect`` leaves all groups, prunes the device from the presence
   tracker, and (if the user has no other devices) broadcasts an offline
   presence update to the org.

Server-side broadcasts are dispatched via ``channels.layers.get_channel_layer``
— see :mod:`realtime.broadcast`. Each event type maps to a handler method on
the consumer (``record_updated`` → ``RealtimeConsumer.record_updated``).
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from channels.generic.websocket import AsyncJsonWebsocketConsumer

from . import broadcast
from .auth import authenticate
from .cursors import tracker as cursor_tracker
from .presence import tracker as presence_tracker

log = logging.getLogger(__name__)


#: Maximum concurrent WebSocket connections per user. The 6th is rejected with
#: a ``connection_limit_exceeded`` error code.
MAX_CONNECTIONS_PER_USER = 5


#: Module-level registry of active connections per user_id — used to enforce
#: the per-user concurrent-connection limit. In a multi-process deployment
#: this should be replaced with a Redis SET, but for a single-process Daphne
#: deployment (the default in dev + small prod) a dict is sufficient.
_active_connections: dict[int, set[str]] = {}


def _connection_count(user_id: int | str) -> int:
    return len(_active_connections.get(int(user_id), set()))


def _register_connection(user_id: int | str, channel_name: str) -> bool:
    """Atomically register a new connection; return ``False`` if over the limit."""
    uid = int(user_id)
    bucket = _active_connections.setdefault(uid, set())
    if len(bucket) >= MAX_CONNECTIONS_PER_USER:
        return False
    bucket.add(channel_name)
    return True


def _unregister_connection(user_id: int | str, channel_name: str) -> None:
    uid = int(user_id)
    bucket = _active_connections.get(uid)
    if bucket is None:
        return
    bucket.discard(channel_name)
    if not bucket:
        _active_connections.pop(uid, None)


class RealtimeConsumer(AsyncJsonWebsocketConsumer):
    """Single WebSocket consumer for all CRM real-time events."""

    # ------------------------------------------------------------------ connect

    async def connect(self) -> None:  # type: ignore[override]
        user = authenticate(self.scope)
        if user is None or not getattr(user, "is_authenticated", False):
            await self.close(code=4401, reason="Unauthorized")
            return

        # Per-user concurrent-connection limit.
        if not _register_connection(user.pk, self.channel_name):
            await self.close(code=4429, reason="connection_limit_exceeded")
            return

        self.user = user  # type: ignore[assignment]
        self.user_id = user.pk  # type: ignore[assignment]
        self.tenant_id = self._resolve_tenant_id(self.scope, user)
        self.device_id = self._device_id()
        self._subscribed_records: set[str] = set()

        await self.accept()

        # Join the user + org groups.
        await self.channel_layer.group_add(f"user:{self.user_id}", self.channel_name)
        if self.tenant_id is not None:
            await self.channel_layer.group_add(f"org:{self.tenant_id}", self.channel_name)

        # Mark the user as online + broadcast presence to the org.
        if self.tenant_id is not None:
            presence_tracker.user_joined(
                org_id=self.tenant_id,
                user_id=self.user_id,
                device_id=self.device_id,
            )
            broadcast.push_presence_update(
                org_id=self.tenant_id,
                user_id=self.user_id,
                status="online",
                is_online=True,
            )

    # ------------------------------------------------------------------ disconnect

    async def disconnect(self, code: int) -> None:  # type: ignore[override]
        user_id = getattr(self, "user_id", None)
        tenant_id = getattr(self, "tenant_id", None)
        device_id = getattr(self, "device_id", None)

        if user_id is not None:
            _unregister_connection(user_id, self.channel_name)
            try:
                await self.channel_layer.group_discard(f"user:{user_id}", self.channel_name)
            except Exception:  # pragma: no cover — defensive
                pass

        if tenant_id is not None and user_id is not None and device_id is not None:
            presence_tracker.user_left(
                org_id=tenant_id,
                user_id=user_id,
                device_id=device_id,
            )
            # Clear cursors on every record the user was viewing.
            for record_key in getattr(self, "_subscribed_records", set()):
                module, _, record_id = record_key.partition(":")
                cursor_tracker.clear_cursor(
                    module=module, record_id=record_id, user_id=user_id
                )
            # If the user has no other devices, broadcast an offline presence.
            if not presence_tracker.is_online(user_id):
                broadcast.push_presence_update(
                    org_id=tenant_id,
                    user_id=user_id,
                    status="offline",
                    is_online=False,
                )

    # ------------------------------------------------------------------ receive_json

    async def receive_json(self, content: Any, **kwargs: Any) -> None:  # type: ignore[override]
        if not isinstance(content, dict):
            return
        msg_type = content.get("type")
        handler = getattr(self, f"_handle_{msg_type}", None) if msg_type else None
        if handler is None:
            await self.send_json({"type": "error", "error": f"unknown type: {msg_type!r}"})
            return
        await handler(content)

    # ------------------------------------------------------------------ inbound handlers

    async def _handle_ping(self, _content: dict[str, Any]) -> None:
        """Heartbeat — refresh presence TTLs and reply ``pong``."""
        tenant_id = getattr(self, "tenant_id", None)
        user_id = getattr(self, "user_id", None)
        device_id = getattr(self, "device_id", None)
        if tenant_id is not None and user_id is not None and device_id is not None:
            presence_tracker.heartbeat(
                org_id=tenant_id,
                user_id=user_id,
                device_id=device_id,
            )
        await self.send_json({"type": "pong", "ts": _now_iso()})

    async def _handle_set_status(self, content: dict[str, Any]) -> None:
        """Client set their presence status (online / away / dnd / busy)."""
        user_id = getattr(self, "user_id", None)
        tenant_id = getattr(self, "tenant_id", None)
        if user_id is None or tenant_id is None:
            return
        status = str(content.get("status") or "online")
        message = str(content.get("message") or "")
        presence_tracker.set_status(user_id=user_id, status=status, message=message)
        broadcast.push_presence_update(
            org_id=tenant_id,
            user_id=user_id,
            status=status,
            is_online=True,
        )

    async def _handle_set_viewing(self, content: dict[str, Any]) -> None:
        """Client announced they're viewing ``module:record_id``."""
        user_id = getattr(self, "user_id", None)
        if user_id is None:
            return
        module = str(content.get("module") or "")
        record_id = str(content.get("record_id") or "")
        record_name = str(content.get("record_name") or "")
        if not module or not record_id:
            return
        presence_tracker.set_viewing(
            user_id=user_id,
            module=module,
            record_id=record_id,
            record_name=record_name,
        )

    async def _handle_subscribe_record(self, content: dict[str, Any]) -> None:
        """Client subscribes to record-scoped broadcasts (cursor / typing)."""
        module = str(content.get("module") or "")
        record_id = str(content.get("record_id") or "")
        if not module or not record_id:
            return
        group = f"record:{module}:{record_id}"
        try:
            await self.channel_layer.group_add(group, self.channel_name)
        except Exception:  # pragma: no cover — defensive
            return
        self._subscribed_records.add(f"{module}:{record_id}")

    async def _handle_unsubscribe_record(self, content: dict[str, Any]) -> None:
        """Client unsubscribes from record-scoped broadcasts."""
        module = str(content.get("module") or "")
        record_id = str(content.get("record_id") or "")
        if not module or not record_id:
            return
        group = f"record:{module}:{record_id}"
        try:
            await self.channel_layer.group_discard(group, self.channel_name)
        except Exception:  # pragma: no cover — defensive
            pass
        # Clear any cursor the user had on this record.
        user_id = getattr(self, "user_id", None)
        if user_id is not None:
            cursor_tracker.clear_cursor(
                module=module, record_id=record_id, user_id=user_id
            )
        self._subscribed_records.discard(f"{module}:{record_id}")

    async def _handle_cursor_update(self, content: dict[str, Any]) -> None:
        """Client moved their cursor — store + broadcast to the record group."""
        user_id = getattr(self, "user_id", None)
        tenant_id = getattr(self, "tenant_id", None)
        if user_id is None or tenant_id is None:
            return
        module = str(content.get("module") or "")
        record_id = str(content.get("record_id") or "")
        field = str(content.get("field") or "")
        position = int(content.get("position") or 0)
        color = str(content.get("color") or "#3b82f6")
        if not module or not record_id:
            return
        cursor_tracker.set_cursor(
            module=module,
            record_id=record_id,
            user_id=user_id,
            field=field,
            position=position,
            color=color,
        )
        broadcast.push_cursor_update(
            module=module,
            record_id=record_id,
            user_id=user_id,
            field=field,
            position=position,
            color=color,
        )

    async def _handle_typing_indicator(self, content: dict[str, Any]) -> None:
        """Client is / stopped typing — broadcast to the record group."""
        user_id = getattr(self, "user_id", None)
        if user_id is None:
            return
        module = str(content.get("module") or "")
        record_id = str(content.get("record_id") or "")
        is_typing = bool(content.get("is_typing"))
        if not module or not record_id:
            return
        broadcast.push_typing_indicator(
            module=module,
            record_id=record_id,
            user_id=user_id,
            is_typing=is_typing,
        )

    async def _handle_get_online_users(self, content: dict[str, Any]) -> None:
        """Client asks for the org's current online user list."""
        tenant_id = getattr(self, "tenant_id", None)
        if tenant_id is None:
            await self.send_json({"type": "online_users", "user_ids": []})
            return
        user_ids = presence_tracker.get_online_users(tenant_id)
        await self.send_json({"type": "online_users", "user_ids": user_ids})

    # ------------------------------------------------------------------ broadcast dispatch

    # Every server-side broadcast is sent with a ``type`` field that maps to a
    # handler name on the consumer. ``AsyncJsonWebsocketConsumer`` invokes the
    # matching method with the full event dict. We forward every event
    # straight to the client as JSON.

    async def _forward(self, event: dict[str, Any]) -> None:
        """Default forwarder — strip the ``type`` field and send to the client."""
        payload = {k: v for k, v in event.items() if k != "type"}
        await self.send_json(payload)

    # The handler methods below are dispatched by Channels based on the
    # ``type`` field set by :func:`realtime.broadcast._event`.

    async def record_created(self, event: dict[str, Any]) -> None:
        await self._forward(event)

    async def record_updated(self, event: dict[str, Any]) -> None:
        await self._forward(event)

    async def record_deleted(self, event: dict[str, Any]) -> None:
        await self._forward(event)

    async def mention(self, event: dict[str, Any]) -> None:
        await self._forward(event)

    async def comment_added(self, event: dict[str, Any]) -> None:
        await self._forward(event)

    async def reaction_added(self, event: dict[str, Any]) -> None:
        await self._forward(event)

    async def task_assigned(self, event: dict[str, Any]) -> None:
        await self._forward(event)

    async def approval_requested(self, event: dict[str, Any]) -> None:
        await self._forward(event)

    async def approval_completed(self, event: dict[str, Any]) -> None:
        await self._forward(event)

    async def file_uploaded(self, event: dict[str, Any]) -> None:
        await self._forward(event)

    async def email_received(self, event: dict[str, Any]) -> None:
        await self._forward(event)

    async def chat_message_received(self, event: dict[str, Any]) -> None:
        await self._forward(event)

    async def presence_update(self, event: dict[str, Any]) -> None:
        await self._forward(event)

    async def cursor_update(self, event: dict[str, Any]) -> None:
        # Don't echo the cursor back to its originator.
        if str(event.get("data", {}).get("user_id")) == str(getattr(self, "user_id", "")):
            return
        await self._forward(event)

    async def typing_indicator(self, event: dict[str, Any]) -> None:
        if str(event.get("data", {}).get("user_id")) == str(getattr(self, "user_id", "")):
            return
        await self._forward(event)

    async def notification(self, event: dict[str, Any]) -> None:
        await self._forward(event)

    # ------------------------------------------------------------------ helpers

    @staticmethod
    def _resolve_tenant_id(scope: dict[str, Any], user: Any) -> int | None:
        """Resolve the active tenant for the WebSocket connection.

        Prefers the ``tenant_id`` query-string param (set by the frontend
        after the user picks an org), then falls back to the user's most
        recent active :class:`TenantMembership`.
        """
        query_string = scope.get("query_string") or b""
        if isinstance(query_string, bytes):
            query_string = query_string.decode("utf-8", "ignore")
        for pair in query_string.split("&"):
            if pair.startswith("tenant_id="):
                raw = pair.split("tenant_id=", 1)[1]
                try:
                    return int(raw)
                except ValueError:
                    return None

        # Fall back to the user's most recent active membership.
        try:
            from api.models import TenantMembership

            membership = (
                TenantMembership.objects.filter(user=user, is_active=True)
                .order_by("-joined_at")
                .select_related("tenant")
                .first()
            )
            return membership.tenant_id if membership else None
        except Exception:  # pragma: no cover — defensive
            return None

    @staticmethod
    def _device_id() -> str:
        """Generate a unique-per-connection device ID."""
        return uuid.uuid4().hex


def _now_iso() -> str:
    """Return the current UTC timestamp as ISO-8601 (used in pong replies)."""
    from django.utils import timezone

    return timezone.now().isoformat()


__all__ = ["MAX_CONNECTIONS_PER_USER", "RealtimeConsumer"]
