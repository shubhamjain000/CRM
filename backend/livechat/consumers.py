"""WebSocket consumer for the livechat app.

The consumer is mounted at ``ws/livechat/{session_id}/`` by
:mod:`livechat.routing` (registered in :mod:`realtime.routing`).

Connection lifecycle
--------------------
1. ``connect`` resolves the JWT (query string / subprotocol — same
   resolution path as :class:`realtime.consumers.RealtimeConsumer`),
   loads the session, enforces membership, joins the
   ``livechat.{session_id}`` group, and accepts the connection.
2. ``receive_json`` dispatches inbound client messages — ``message``
   (from visitor or agent) is appended to the session via
   :func:`livechat.services.send_message` (which broadcasts the
   ``chat_message`` event back to the group).
3. ``disconnect`` leaves the group.

Server-side broadcasts are dispatched by
:func:`livechat.services._broadcast_message` via the channel-layer
``group_send`` API — this consumer's ``chat_message`` method is the
fan-out target.
"""

from __future__ import annotations

import logging
from typing import Any

from channels.generic.websocket import AsyncJsonWebsocketConsumer

from livechat.models import ChatSession

log = logging.getLogger(__name__)


class LiveChatConsumer(AsyncJsonWebsocketConsumer):
    """Real-time chat WebSocket consumer."""

    async def connect(self) -> None:
        session_id = self.scope["url_route"]["kwargs"]["session_id"]
        try:
            session_pk = int(session_id)
        except (TypeError, ValueError):
            await self.close(code=4000)
            return
        # Auth + membership resolution mirrors the realtime app's consumer.
        from realtime.auth import authenticate  # noqa: PLC0415

        token = self._extract_token()
        user = await authenticate(token) if token else None
        if user is None or not user.is_authenticated:
            await self.close(code=4401)
            return
        session = await self._load_session(session_pk)
        if session is None:
            await self.close(code=4404)
            return
        self.session_id = session_pk
        self.user = user
        self.group_name = f"livechat.{session_pk}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        log.info("livechat ws: user %s connected to session %s", user.pk, session_pk)

    async def disconnect(self, code: int) -> None:  # type: ignore[override]
        group = getattr(self, "group_name", None)
        if group is not None:
            await self.channel_layer.group_discard(group, self.channel_name)

    async def receive_json(self, content: Any, **kwargs: Any) -> None:  # type: ignore[override]
        """Dispatch an inbound client message.

        Recognized types:
        * ``{"type": "message", "sender": "visitor|agent|bot", "body": "..."}``
          — append a message to the session via the service layer.
        * ``{"type": "ping"}`` — heartbeat; responds with ``{"type": "pong"}``.
        """
        msg_type = (content or {}).get("type")
        if msg_type == "ping":
            await self.send_json({"type": "pong"})
            return
        if msg_type != "message":
            await self.send_json({"type": "error", "detail": "unknown message type"})
            return
        sender = content.get("sender", "visitor")
        body = content.get("body", "")
        if not body:
            await self.send_json({"type": "error", "detail": "body is required"})
            return
        from asgiref.sync import sync_to_async  # noqa: PLC0415

        from livechat.services import send_message  # noqa: PLC0415

        try:
            await sync_to_async(send_message)(
                session=await self._load_session(self.session_id),
                sender=sender,
                body=body,
                attachments=content.get("attachments"),
            )
        except ValueError as exc:
            await self.send_json({"type": "error", "detail": str(exc)})

    async def chat_message(self, event: dict[str, Any]) -> None:
        """Fan-out handler — called by ``group_send`` from the service layer."""
        await self.send_json(
            {
                "type": "message",
                "id": event.get("id"),
                "session_id": event.get("session_id"),
                "sender": event.get("sender"),
                "body": event.get("body"),
                "attachments": event.get("attachments", []),
                "timestamp": event.get("timestamp"),
            }
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _extract_token(self) -> str | None:
        query_string = (self.scope.get("query_string") or b"").decode("utf-8")
        for pair in query_string.split("&"):
            if pair.startswith("token="):
                return pair[len("token=") :]
        subprotocols = self.scope.get("subprotocols") or []
        for proto in subprotocols:
            if proto.startswith("jwt."):
                return proto[len("jwt.") :]
        for header, value in self.scope.get("headers") or []:
            if header == b"authorization":
                value_str = value.decode("latin-1")
                if value_str.lower().startswith("bearer "):
                    return value_str[len("bearer ") :]
        return None

    async def _load_session(self, session_pk: int) -> ChatSession | None:
        from asgiref.sync import sync_to_async  # noqa: PLC0415

        try:
            return await sync_to_async(ChatSession.objects.select_related("tenant").get)(
                pk=session_pk
            )
        except ChatSession.DoesNotExist:
            return None


__all__ = ["LiveChatConsumer"]
