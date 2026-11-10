"""JWT authentication helpers for the realtime WebSocket layer.

Django Channels doesn't run the standard middleware stack, so
:class:`realtime.consumers.RealtimeConsumer` resolves the caller's JWT from
either the ``Sec-WebSocket-Protocol`` subprotocol or the ``?token=`` query
string (browsers can't set arbitrary headers on the WebSocket handshake).

The helpers below are pure functions so they're trivially unit-testable.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import AccessToken

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import User

log = logging.getLogger(__name__)


def _extract_token(scope: dict[str, Any]) -> str | None:
    """Extract a JWT from the WebSocket connection scope.

    Order of precedence:

    1. ``Sec-WebSocket-Protocol`` subprotocol — ``Authorization.Bearer.<jwt>``.
       Browsers can't set arbitrary headers, so the frontend stuffs the JWT
       into the subprotocol list (which IS configurable via the WebSocket
       constructor's second argument).
    2. ``?token=<jwt>`` query string.
    3. ``Authorization`` header (only useful for non-browser clients).
    """
    # 1. Subprotocol.
    for subprotocol in scope.get("subprotocols") or []:
        if subprotocol.startswith("Authorization.Bearer."):
            return subprotocol.split("Authorization.Bearer.", 1)[1] or None
        if subprotocol.startswith("Bearer."):
            return subprotocol.split("Bearer.", 1)[1] or None

    # 2. Query string.
    query_string = scope.get("query_string") or b""
    if isinstance(query_string, bytes):
        query_string = query_string.decode("utf-8", "ignore")
    for pair in query_string.split("&"):
        if pair.startswith("token="):
            return pair.split("token=", 1)[1] or None
        if pair.startswith("access_token="):
            return pair.split("access_token=", 1)[1] or None

    # 3. Authorization header.
    for name, value in scope.get("headers") or []:
        if name == b"authorization":
            value_str = value.decode("utf-8", "ignore") if isinstance(value, bytes) else str(value)
            if value_str.lower().startswith("bearer "):
                return value_str.split(" ", 1)[1] or None
    return None


def authenticate(scope: dict[str, Any]) -> "User | None":
    """Resolve the user from the JWT in ``scope``.

    Returns ``None`` when no token is present, the token is malformed, the
    token is blacklisted, or the user no longer exists / is inactive.
    """
    token = _extract_token(scope)
    if not token:
        return None

    from api.models import User

    try:
        access = AccessToken(token)
        user_id = access.get("user_id")
    except (TokenError, InvalidToken) as exc:
        log.info("realtime.authenticate: invalid token (%s)", exc)
        return None
    except Exception:  # pragma: no cover — defensive
        log.exception("realtime.authenticate: unexpected error decoding token")
        return None

    if not user_id:
        return None
    user = User.objects.filter(pk=user_id, is_active=True).first()
    return user


__all__ = ["authenticate"]
