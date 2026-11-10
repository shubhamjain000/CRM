"""ASGI config for Daphne / Channels.

The ``ProtocolTypeRouter`` dispatches by connection type:

* ``http`` — standard Django request/response cycle (DRF, admin, OpenAPI).
* ``websocket`` — :class:`realtime.consumers.RealtimeConsumer`, mounted at
  ``ws/realtime/`` by :mod:`realtime.routing`.

``AuthMiddlewareStack`` populates ``scope["user"]`` for session-based
clients. JWT-authenticated clients (the default for the CRM frontend) are
resolved inside the consumer via :func:`realtime.auth.authenticate`, which
reads the JWT from the ``Sec-WebSocket-Protocol`` subprotocol, the
``?token=`` query string, or the ``Authorization`` header (Browsers can't
set arbitrary headers on the WebSocket handshake).
"""

from __future__ import annotations

import os

from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application

from realtime.routing import websocket_urlpatterns

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

application = ProtocolTypeRouter(
    {
        "http": get_asgi_application(),
        "websocket": AuthMiddlewareStack(URLRouter(websocket_urlpatterns)),
    }
)
