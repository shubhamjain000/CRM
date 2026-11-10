"""Redis-backed presence tracking.

A single :class:`PresenceTracker` instance is exported as ``tracker`` for use
by :mod:`realtime.consumers` and any service that needs to query the online
state of users (e.g. before deciding whether to send a push vs. an in-app
notification).

Three data structures are kept in Redis:

* ``presence:org:{org_id}`` — a Redis ``SET`` of ``user_id:device_id`` tokens
  currently online in the org. ``SMEMBERS`` returns the unique user IDs (split
  on ``:``).
* ``presence:status:{user_id}`` — a Redis ``HASH`` with ``status`` and
  ``message`` fields, refreshed on every heartbeat.
* ``presence:viewing:{user_id}`` — a Redis ``HASH`` with ``module``,
  ``record_id``, and ``record_name`` fields, refreshed on every
  ``set_viewing`` call.

All keys have a 60-second TTL, refreshed by the consumer's heartbeat. If no
heartbeat arrives for ~90s, the consumer treats the user as offline (the
TTL will have expired by then and the next presence sweep removes them).
"""

from __future__ import annotations

import logging
from typing import Any

from django.core.cache import cache

log = logging.getLogger(__name__)


#: Presence heartbeat TTL — keys auto-expire after this many seconds.
PRESENCE_TTL_SECONDS = 60
#: Time after which a user is considered offline (slightly longer than the TTL
#: so a flaky heartbeat doesn't immediately mark them offline).
OFFLINE_GRACE_SECONDS = 90

_ORG_KEY = "presence:org:{org_id}"
_STATUS_KEY = "presence:status:{user_id}"
_VIEWING_KEY = "presence:viewing:{user_id}"
_DEVICE_KEY = "presence:device:{user_id}:{device_id}"


def _redis() -> Any:
    """Return the raw Redis client backing Django's cache, or ``None``.

    Django's ``RedisCache`` exposes a ``client`` property on its ``_cache``
    attribute; we use ``get_client`` when available (django-redis) or fall
    back to ``None`` (the tracker then degrades to no-op / empty results so
    the WebSocket flow still works in tests that don't have Redis).
    """
    try:
        backend = cache._cache  # type: ignore[attr-defined]
    except AttributeError:  # pragma: no cover — defensive
        return None
    client = getattr(backend, "client", None)
    if client is None:
        return None
    # django-redis wraps a connection pool; ``get_client`` returns the raw client.
    get_client = getattr(client, "get_client", None)
    if callable(get_client):
        try:
            return get_client()
        except Exception:  # pragma: no cover — defensive
            return None
    return client


class PresenceTracker:
    """Redis-backed presence + status + "currently viewing" registry."""

    # ------------------------------------------------------------------ join / leave

    def user_joined(
        self,
        *,
        org_id: int | str,
        user_id: int | str,
        device_id: str,
        status: str = "online",
        message: str = "",
    ) -> None:
        """Mark ``user_id:device_id`` as online in ``org_id``."""
        client = _redis()
        if client is None:
            return
        token = f"{user_id}:{device_id}"
        org_key = _ORG_KEY.format(org_id=org_id)
        device_key = _DEVICE_KEY.format(user_id=user_id, device_id=device_id)
        try:
            pipe = client.pipeline()
            pipe.sadd(org_key, token)
            pipe.expire(org_key, OFFLINE_GRACE_SECONDS)
            pipe.hset(_STATUS_KEY.format(user_id=user_id), mapping={
                "status": status,
                "message": message,
            })
            pipe.expire(_STATUS_KEY.format(user_id=user_id), PRESENCE_TTL_SECONDS)
            pipe.set(device_key, "1", ex=OFFLINE_GRACE_SECONDS)
            pipe.execute()
        except Exception:  # pragma: no cover — defensive
            log.exception("PresenceTracker.user_joined: redis error")

    def user_left(
        self,
        *,
        org_id: int | str,
        user_id: int | str,
        device_id: str,
    ) -> None:
        """Mark ``user_id:device_id`` as offline in ``org_id``."""
        client = _redis()
        if client is None:
            return
        token = f"{user_id}:{device_id}"
        org_key = _ORG_KEY.format(org_id=org_id)
        device_key = _DEVICE_KEY.format(user_id=user_id, device_id=device_id)
        try:
            pipe = client.pipeline()
            pipe.srem(org_key, token)
            pipe.delete(device_key)
            # If the user has no remaining devices, clear their status.
            remaining = self._user_device_count(client, user_id)
            if remaining == 0:
                pipe.delete(_STATUS_KEY.format(user_id=user_id))
                pipe.delete(_VIEWING_KEY.format(user_id=user_id))
            pipe.execute()
        except Exception:  # pragma: no cover — defensive
            log.exception("PresenceTracker.user_left: redis error")

    def heartbeat(
        self,
        *,
        org_id: int | str,
        user_id: int | str,
        device_id: str,
    ) -> None:
        """Refresh the TTL on the caller's presence keys (called every 30s)."""
        # Re-joining is equivalent to refreshing the TTLs.
        self.user_joined(org_id=org_id, user_id=user_id, device_id=device_id)

    # ------------------------------------------------------------------ queries

    def get_online_users(self, org_id: int | str) -> list[int]:
        """Return the sorted list of distinct user IDs online in ``org_id``."""
        client = _redis()
        if client is None:
            return []
        try:
            tokens = client.smembers(_ORG_KEY.format(org_id=org_id)) or set()
        except Exception:  # pragma: no cover — defensive
            return []
        user_ids: set[int] = set()
        for token in tokens:
            if isinstance(token, bytes):
                token = token.decode("utf-8", "ignore")
            try:
                user_id_str = str(token).split(":", 1)[0]
                user_ids.add(int(user_id_str))
            except (ValueError, IndexError):
                continue
        return sorted(user_ids)

    def is_online(self, user_id: int | str) -> bool:
        """Return ``True`` if the user has any active device tokens."""
        client = _redis()
        if client is None:
            return False
        try:
            keys = client.keys(_DEVICE_KEY.format(user_id=user_id, device_id="*"))
        except Exception:  # pragma: no cover — defensive
            return False
        return bool(keys)

    def get_status(self, user_id: int | str) -> dict[str, Any]:
        """Return ``{"status", "message"}`` for the user (or empty dict)."""
        client = _redis()
        if client is None:
            return {}
        try:
            raw = client.hgetall(_STATUS_KEY.format(user_id=user_id)) or {}
        except Exception:  # pragma: no cover — defensive
            return {}
        out: dict[str, Any] = {}
        for key, value in raw.items():
            if isinstance(key, bytes):
                key = key.decode("utf-8", "ignore")
            if isinstance(value, bytes):
                value = value.decode("utf-8", "ignore")
            out[key] = value
        return out

    def set_status(
        self,
        *,
        user_id: int | str,
        status: str,
        message: str = "",
    ) -> None:
        """Set the user's status (online / away / dnd / busy) + optional message."""
        client = _redis()
        if client is None:
            return
        try:
            pipe = client.pipeline()
            pipe.hset(_STATUS_KEY.format(user_id=user_id), mapping={
                "status": status,
                "message": message,
            })
            pipe.expire(_STATUS_KEY.format(user_id=user_id), PRESENCE_TTL_SECONDS)
            pipe.execute()
        except Exception:  # pragma: no cover — defensive
            log.exception("PresenceTracker.set_status: redis error")

    # ------------------------------------------------------------------ viewing

    def set_viewing(
        self,
        *,
        user_id: int | str,
        module: str,
        record_id: str,
        record_name: str = "",
    ) -> None:
        """Record that ``user_id`` is currently viewing ``module:record_id``."""
        client = _redis()
        if client is None:
            return
        try:
            pipe = client.pipeline()
            pipe.hset(_VIEWING_KEY.format(user_id=user_id), mapping={
                "module": module,
                "record_id": str(record_id),
                "record_name": record_name,
            })
            pipe.expire(_VIEWING_KEY.format(user_id=user_id), PRESENCE_TTL_SECONDS)
            pipe.execute()
        except Exception:  # pragma: no cover — defensive
            log.exception("PresenceTracker.set_viewing: redis error")

    def clear_viewing(self, user_id: int | str) -> None:
        """Clear the user's "currently viewing" pointer."""
        client = _redis()
        if client is None:
            return
        try:
            client.delete(_VIEWING_KEY.format(user_id=user_id))
        except Exception:  # pragma: no cover — defensive
            log.exception("PresenceTracker.clear_viewing: redis error")

    def get_viewing(self, user_id: int | str) -> dict[str, Any]:
        """Return ``{module, record_id, record_name}`` for the user (or empty dict)."""
        client = _redis()
        if client is None:
            return {}
        try:
            raw = client.hgetall(_VIEWING_KEY.format(user_id=user_id)) or {}
        except Exception:  # pragma: no cover — defensive
            return {}
        out: dict[str, Any] = {}
        for key, value in raw.items():
            if isinstance(key, bytes):
                key = key.decode("utf-8", "ignore")
            if isinstance(value, bytes):
                value = value.decode("utf-8", "ignore")
            out[key] = value
        return out

    # ------------------------------------------------------------------ helpers

    @staticmethod
    def _user_device_count(client: Any, user_id: int | str) -> int:
        """Count the user's remaining device tokens (used by user_left)."""
        try:
            keys = client.keys(_DEVICE_KEY.format(user_id=user_id, device_id="*"))
        except Exception:  # pragma: no cover — defensive
            return 0
        return len(keys) if keys else 0


#: Module-level singleton — the consumer and services import this directly.
tracker = PresenceTracker()


__all__ = ["OFFLINE_GRACE_SECONDS", "PRESENCE_TTL_SECONDS", "PresenceTracker", "tracker"]
