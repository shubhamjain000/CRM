"""WebSocket URL routing for the livechat app.

Mounted by :mod:`realtime.routing` (which is mounted by
:mod:`config.asgi`). The single ``ws/livechat/<session_id>/`` route
accepts the :class:`livechat.consumers.LiveChatConsumer`.

Client connection example::

    const ws = new WebSocket(
        "wss://app.example.com/ws/livechat/42/?token=<JWT>",
    );
    ws.send(JSON.stringify({type: "message", sender: "visitor", body: "Hi"}));
"""

from __future__ import annotations

from django.urls import path

from .consumers import LiveChatConsumer

websocket_urlpatterns = [
    path("ws/livechat/<str:session_id>/", LiveChatConsumer.as_asgi()),
]
