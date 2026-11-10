"""WebSocket URL routing for the realtime app.

Mounted by ``config/asgi.py`` via a ``ProtocolTypeRouter`` + ``URLRouter``.
The single ``ws/realtime/`` route accepts the :class:`RealtimeConsumer`;
the ``ws/livechat/<session_id>/`` route (added in Phase 14) accepts the
:class:`livechat.consumers.LiveChatConsumer` for per-session chat rooms.

Client connection example::

    const ws = new WebSocket(
        "wss://app.example.com/ws/realtime/?token=<JWT>&tenant_id=<org_id>",
    );

    ws.send(JSON.stringify({type: "ping"}));
    ws.send(JSON.stringify({
        type: "subscribe_record",
        module: "deal",
        record_id: "42",
    }));
"""

from __future__ import annotations

from django.urls import path

from livechat.consumers import LiveChatConsumer

from .consumers import RealtimeConsumer

websocket_urlpatterns = [
    path("ws/realtime/", RealtimeConsumer.as_asgi()),
    # Phase 14 — live chat WebSocket consumer (per-session room).
    path("ws/livechat/<str:session_id>/", LiveChatConsumer.as_asgi()),
]
