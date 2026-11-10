"""Realtime app — Django Channels WebSocket layer for the CRM.

Provides:

* :class:`realtime.consumers.RealtimeConsumer` — an ``AsyncJsonWebsocketConsumer``
  that authenticates the caller via JWT, joins their per-user and per-org
  groups, enforces a per-user concurrent-connection limit, and dispatches
  server-side broadcasts (record updates, mentions, notifications, presence,
  cursors, typing indicators) over the Channels layer.
* :mod:`realtime.routing` — URL routing for ``ws/realtime/``.
* :mod:`realtime.presence` — :class:`PresenceTracker`, a Redis-backed
  presence + status + "currently viewing" registry with a 60s heartbeat TTL.
* :mod:`realtime.cursors` — :class:`CursorTracker`, a Redis-backed live-cursor
  registry with a 5s auto-expire.
* :mod:`realtime.broadcast` — thin helpers (``broadcast_to_user``,
  ``broadcast_to_org``, ``broadcast_to_record``) for the rest of the codebase
  to push events into WebSocket groups without having to know about the
  Channels layer API.

The WebSocket endpoint is exposed at ``ws/realtime/`` and is mounted by
``config/asgi.py`` via a ``ProtocolTypeRouter``.
"""
