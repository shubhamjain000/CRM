"""Redis-backed live-cursor tracking.

A single :class:`CursorTracker` instance is exported as ``tracker`` for use by
:mod:`realtime.consumers`. Cursors auto-expire after 5 seconds of no update —
if a user stops typing / moving their cursor, the next ``get_cursors`` call
from any peer will not see them (so the frontend can stop rendering the
ghost cursor).

Storage layout:

* ``cursor:{module}:{record_id}`` — a Redis ``HASH`` keyed by ``user_id``
  with JSON-encoded ``{field, position, color, updated_at}`` values.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from django.core.cache import cache

log = logging.getLogger(__name__)


#: Cursor auto-expire — peers stop rendering a cursor that hasn't been updated
#: in the last 5 seconds.
CURSOR_TTL_SECONDS = 5
#: The HASH itself expires after 1 hour of inactivity so we don't leak memory
#: on records users have long left.
CURSOR_BUCKET_TTL_SECONDS = 3600

_BUCKET_KEY = "cursor:{module}:{record_id}"


def _redis() -> Any:
    """Return the raw Redis client backing Django's cache, or ``None``."""
    try:
        backend = cache._cache  # type: ignore[attr-defined]
    except AttributeError:  # pragma: no cover — defensive
        return None
    client = getattr(backend, "client", None)
    if client is None:
        return None
    get_client = getattr(client, "get_client", None)
    if callable(get_client):
        try:
            return get_client()
        except Exception:  # pragma: no cover — defensive
            return None
    return client


class CursorTracker:
    """Redis-backed live-cursor registry with 5s auto-expire."""

    def set_cursor(
        self,
        *,
        module: str,
        record_id: str,
        user_id: int | str,
        field: str,
        position: int,
        color: str = "#3b82f6",
    ) -> None:
        """Set / refresh a cursor for ``user_id`` on ``module:record_id``."""
        client = _redis()
        if client is None:
            return
        bucket = _BUCKET_KEY.format(module=module, record_id=record_id)
        try:
            payload = json.dumps({
                "field": field,
                "position": int(position),
                "color": color,
                "updated_at": time.time(),
            })
            pipe = client.pipeline()
            pipe.hset(bucket, str(user_id), payload)
            pipe.expire(bucket, CURSOR_BUCKET_TTL_SECONDS)
            pipe.execute()
        except Exception:  # pragma: no cover — defensive
            log.exception("CursorTracker.set_cursor: redis error")

    def get_cursors(
        self,
        *,
        module: str,
        record_id: str,
    ) -> list[dict[str, Any]]:
        """Return the list of live cursors on ``module:record_id``.

        Stale cursors (older than :data:`CURSOR_TTL_SECONDS`) are filtered out
        and pruned from the hash so the bucket doesn't grow unbounded.
        """
        client = _redis()
        if client is None:
            return []
        bucket = _BUCKET_KEY.format(module=module, record_id=record_id)
        try:
            raw = client.hgetall(bucket) or {}
        except Exception:  # pragma: no cover — defensive
            return []

        now = time.time()
        out: list[dict[str, Any]] = []
        stale: list[str] = []
        for raw_user, raw_payload in raw.items():
            user_key = (
                raw_user.decode("utf-8", "ignore")
                if isinstance(raw_user, bytes)
                else str(raw_user)
            )
            payload_str = (
                raw_payload.decode("utf-8", "ignore")
                if isinstance(raw_payload, bytes)
                else str(raw_payload)
            )
            try:
                payload = json.loads(payload_str)
            except json.JSONDecodeError:
                stale.append(user_key)
                continue
            if now - float(payload.get("updated_at") or 0) > CURSOR_TTL_SECONDS:
                stale.append(user_key)
                continue
            try:
                user_id_int = int(user_key)
            except ValueError:
                continue
            out.append({
                "user_id": user_id_int,
                "field": payload.get("field", ""),
                "position": int(payload.get("position", 0)),
                "color": payload.get("color", "#3b82f6"),
            })

        if stale and client is not None:
            try:
                client.hdel(bucket, *stale)
            except Exception:  # pragma: no cover — defensive
                pass
        return out

    def clear_cursor(
        self,
        *,
        module: str,
        record_id: str,
        user_id: int | str,
    ) -> None:
        """Remove a single cursor (called on socket disconnect / blur)."""
        client = _redis()
        if client is None:
            return
        bucket = _BUCKET_KEY.format(module=module, record_id=record_id)
        try:
            client.hdel(bucket, str(user_id))
        except Exception:  # pragma: no cover — defensive
            log.exception("CursorTracker.clear_cursor: redis error")


#: Module-level singleton — the consumer imports this directly.
tracker = CursorTracker()


__all__ = [
    "CURSOR_BUCKET_TTL_SECONDS",
    "CURSOR_TTL_SECONDS",
    "CursorTracker",
    "tracker",
]
