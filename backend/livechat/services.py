"""Service layer for the livechat app.

Functions here are the canonical interface used by :mod:`livechat.viewsets`
and the WebSocket consumer. The :func:`convert_to_lead` helper demonstrates
the channel-to-CRM bridge — a session with a captured email/phone is
promoted to a :class:`leads.models.Lead` for downstream sales workflow.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from django.db import transaction
from django.utils import timezone

from .models import (
    ChatMessage,
    ChatSession,
    SENDER_AGENT,
    SENDER_BOT,
    SENDER_VISITOR,
    STATUS_ACTIVE,
    STATUS_ENDED,
    STATUS_WAITING,
)

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import User

log = logging.getLogger(__name__)


###############################################################################
# Session lifecycle
###############################################################################


def create_session(visitor_data: dict[str, Any], tenant: Any = None) -> ChatSession:
    """Create a new :class:`ChatSession` from the visitor payload.

    ``visitor_data`` typically contains ``visitor_id`` (required),
    ``visitor_name`` / ``visitor_email`` / ``visitor_phone`` / ``visitor_ip``
    / ``visitor_geo`` / ``visitor_user_agent`` / ``pages_visited`` /
    ``referrer``. Unknown keys are ignored. ``tenant`` is resolved from
    the thread-local context when not supplied (see
    :func:`api.managers.get_current_tenant`).
    """
    if tenant is None:
        from api.managers import get_current_tenant  # noqa: PLC0415

        tenant = get_current_tenant()
    session = ChatSession.objects.create(
        tenant=tenant,
        visitor_id=visitor_data.get("visitor_id") or _fallback_visitor_id(visitor_data),
        visitor_name=visitor_data.get("visitor_name", ""),
        visitor_email=visitor_data.get("visitor_email", ""),
        visitor_phone=visitor_data.get("visitor_phone", ""),
        visitor_ip=visitor_data.get("visitor_ip"),
        visitor_geo=visitor_data.get("visitor_geo") or {},
        visitor_user_agent=visitor_data.get("visitor_user_agent", ""),
        pages_visited=visitor_data.get("pages_visited") or [],
        referrer=visitor_data.get("referrer", ""),
        status=STATUS_WAITING,
        started_at=timezone.now(),
    )
    log.info("livechat.create_session: session %s for visitor %s", session.pk, session.visitor_id)
    return session


def assign_session(session: ChatSession, user: "User") -> ChatSession:
    """Assign ``session`` to ``user`` and flip status to ``active``."""
    session.assigned_to = user
    session.status = STATUS_ACTIVE
    session.save(update_fields=["assigned_to", "status", "updated_at"])
    log.info(
        "livechat.assign_session: session %s → user %s", session.pk, user.pk
    )
    return session


def end_session(session: ChatSession, satisfaction: int | None = None) -> ChatSession:
    """Mark ``session`` as ended and record the optional CSAT score (0-5)."""
    session.status = STATUS_ENDED
    session.ended_at = timezone.now()
    if satisfaction is not None:
        score = max(0, min(5, int(satisfaction)))
        session.satisfaction_score = score
    _refresh_transcript(session)
    session.save(
        update_fields=[
            "status",
            "ended_at",
            "satisfaction_score",
            "transcript",
            "updated_at",
        ]
    )
    return session


###############################################################################
# Messages
###############################################################################


def send_message(
    session: ChatSession,
    sender: str,
    body: str,
    attachments: list[dict[str, Any]] | None = None,
) -> ChatMessage:
    """Append a message to ``session`` and broadcast to the WS group.

    ``sender`` is one of ``visitor`` / ``agent`` / ``bot``. The function
    is deliberately synchronous — the WebSocket consumer calls it from
    inside ``receive_json`` and the channel-layer broadcast happens
    separately so we don't block the event loop.
    """
    if sender not in (SENDER_VISITOR, SENDER_AGENT, SENDER_BOT):
        raise ValueError(f"send_message: unknown sender {sender!r}")
    if not body and not attachments:
        raise ValueError("send_message: 'body' or 'attachments' is required.")
    msg = ChatMessage.objects.create(
        tenant=session.tenant,
        session=session,
        sender=sender,
        body=body or "",
        attachments=list(attachments or []),
        timestamp=timezone.now(),
        is_read=sender == SENDER_AGENT,  # agent messages are auto-read
    )
    _broadcast_message(msg)
    return msg


###############################################################################
# Lead conversion
###############################################################################


def convert_to_lead(session: ChatSession) -> Any:
    """Promote a chat session to a :class:`leads.models.Lead`.

    Requires ``visitor_email`` or ``visitor_phone``. The Lead's
    ``lead_source`` is set to ``other`` (live chat is not in the
    canonical Lead.LEAD_SOURCE_CHOICES list — we use the closest match).
    Returns the created Lead, or raises :class:`ValueError` if no
    identifiable visitor info is present.
    """
    if not session.visitor_email and not session.visitor_phone:
        raise ValueError("convert_to_lead: visitor_email or visitor_phone is required.")
    try:
        from leads.models import Lead  # noqa: PLC0415 — lazy
    except Exception as exc:  # pragma: no cover — leads app always present
        raise RuntimeError("leads app not installed") from exc
    name_parts = (session.visitor_name or "").split(" ", 1)
    first_name = name_parts[0] or "Visitor"
    last_name = name_parts[1] if len(name_parts) > 1 else ""
    emails = [{"email": session.visitor_email, "label": "chat"}] if session.visitor_email else []
    phones = [{"phone": session.visitor_phone, "label": "chat"}] if session.visitor_phone else []
    with transaction.atomic():
        lead = Lead.objects.create(
            tenant=session.tenant,
            first_name=first_name,
            last_name=last_name,
            company="",
            emails=emails,
            phones=phones,
            lead_source="other",
            lead_status="new",
            owner=session.assigned_to or _fallback_owner(),
            description=f"Converted from live chat session #{session.pk}",
        )
        session.related_module = "leads"
        session.related_id = str(lead.pk)
        session.save(update_fields=["related_module", "related_id", "updated_at"])
    log.info("livechat.convert_to_lead: session %s → lead %s", session.pk, lead.pk)
    return lead


###############################################################################
# Internal helpers
###############################################################################


def _refresh_transcript(session: ChatSession) -> None:
    """Rebuild the denormalized ``transcript`` text from messages."""
    lines: list[str] = []
    for msg in session.messages.order_by("timestamp"):  # type: ignore[attr-defined]
        ts = msg.timestamp.strftime("%H:%M:%S")
        lines.append(f"[{ts}] {msg.sender}: {msg.body}")
    session.transcript = "\n".join(lines)


def _broadcast_message(msg: ChatMessage) -> None:
    """Fan the message out to the livechat WS group for the session."""
    try:
        from channels.layers import get_channel_layer  # noqa: PLC0415
        from asgiref.sync import async_to_sync  # noqa: PLC0415
    except Exception:  # pragma: no cover — channels always present
        return
    layer = get_channel_layer()
    if layer is None:
        return
    async_to_sync(layer.group_send)(
        f"livechat.{msg.session_id}",
        {
            "type": "chat_message",
            "id": msg.pk,
            "session_id": msg.session_id,
            "sender": msg.sender,
            "body": msg.body,
            "attachments": msg.attachments,
            "timestamp": msg.timestamp.isoformat(),
        },
    )


def _fallback_visitor_id(visitor_data: dict[str, Any]) -> str:
    import uuid

    return visitor_data.get("visitor_id") or f"anon-{uuid.uuid4()}"


def _fallback_owner() -> "User":
    """First user in the DB — used when no agent is assigned to a session."""
    from api.models import User  # noqa: PLC0415

    user = User.objects.first()
    if user is None:  # pragma: no cover — should never happen
        raise RuntimeError("No users in DB to assign as Lead owner.")
    return user


__all__ = [
    "assign_session",
    "convert_to_lead",
    "create_session",
    "end_session",
    "send_message",
]
