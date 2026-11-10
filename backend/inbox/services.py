"""Service layer for the unified inbox app.

This is the orchestration layer that unifies the five channel apps
(email / WhatsApp / telephony / livechat / social / SMS) into a single
conversation surface. It does not duplicate channel-specific logic —
each ``send_reply`` call delegates to the underlying channel app's
service layer (e.g. :func:`email_integration.services.send_email`).
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from django.db import transaction
from django.db.models import Count
from django.db.models.functions import TruncDate
from django.utils import timezone

from .models import (
    CHANNEL_EMAIL,
    CHANNEL_LIVECHAT,
    CHANNEL_SOCIAL,
    CHANNEL_SMS,
    CHANNEL_TELEPHONY,
    CHANNEL_WHATSAPP,
    PRIORITY_NORMAL,
    SENDER_AGENT,
    STATUS_CLOSED,
    STATUS_OPEN,
    STATUS_RESOLVED,
    UnifiedConversation,
    UnifiedMessage,
)

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import User

log = logging.getLogger(__name__)


###############################################################################
# Querying
###############################################################################


def get_conversations(filters: dict[str, Any] | None = None) -> Any:
    """Return a queryset of :class:`UnifiedConversation` rows for the tenant.

    Supported filters: ``channel`` / ``status`` / ``assigned_to`` /
    ``priority`` / ``is_unassigned`` / ``participant_identifier`` /
    ``tag`` / ``last_message_at__gte`` / ``last_message_at__lte``.
    Merged conversations (``is_merged=True``) are excluded by default.
    """
    qs = UnifiedConversation.objects.select_related("tenant", "assigned_to").filter(
        is_merged=False
    )
    f = filters or {}
    if f.get("channel"):
        qs = qs.filter(channel=f["channel"])
    if f.get("status"):
        qs = qs.filter(status=f["status"])
    if f.get("assigned_to"):
        qs = qs.filter(assigned_to_id=f["assigned_to"])
    if f.get("priority"):
        qs = qs.filter(priority=f["priority"])
    if f.get("is_unassigned"):
        qs = qs.filter(assigned_to__isnull=True)
    if f.get("participant_identifier"):
        qs = qs.filter(participant_identifier=f["participant_identifier"])
    if f.get("tag"):
        qs = qs.filter(tags__contains=[f["tag"]])
    if f.get("last_message_at__gte"):
        qs = qs.filter(last_message_at__gte=f["last_message_at__gte"])
    if f.get("last_message_at__lte"):
        qs = qs.filter(last_message_at__lte=f["last_message_at__lte"])
    return qs.order_by("-last_message_at")


###############################################################################
# Reply
###############################################################################


def send_reply(
    conversation: UnifiedConversation,
    body: str,
    channel: str | None = None,
    *,
    user: "User | None" = None,
) -> UnifiedMessage:
    """Send a reply on ``conversation`` via the appropriate channel app.

    ``channel`` defaults to ``conversation.channel`` (auto-detect). The
    reply is dispatched via the underlying channel's service layer (or
    a stub for unsupported channels). Returns the :class:`UnifiedMessage`
    row created in the unified inbox.
    """
    if not body:
        raise ValueError("send_reply: body is required.")
    target_channel = channel or conversation.channel
    _dispatch_channel_reply(conversation, target_channel, body, user)
    msg = UnifiedMessage.objects.create(
        tenant=conversation.tenant,
        conversation=conversation,
        channel=target_channel,
        sender=SENDER_AGENT,
        body=body,
        attachments=[],
        timestamp=timezone.now(),
        is_read=True,
        metadata={"agent_id": user.pk if user else None},
    )
    conversation.last_message_at = msg.timestamp
    conversation.message_count = (conversation.message_count or 0) + 1
    if conversation.status in (STATUS_RESOLVED, STATUS_CLOSED):
        conversation.status = STATUS_OPEN
    conversation.save(
        update_fields=["last_message_at", "message_count", "status", "updated_at"]
    )
    return msg


def _dispatch_channel_reply(
    conversation: UnifiedConversation,
    channel: str,
    body: str,
    user: "User | None",
) -> None:
    """Hand the reply off to the channel's own service layer.

    Failures are logged but do not abort the unified-inbox row write —
    the agent's intent is captured in :class:`UnifiedMessage` regardless
    of whether the downstream channel dispatched successfully.
    """
    try:
        if channel == CHANNEL_EMAIL:
            from email_integration.models import EmailAccount
            from email_integration.services import send_email

            account = EmailAccount.objects.filter(
                tenant=conversation.tenant, is_active=True
            ).first()
            if account is not None:
                send_email(
                    account=account,
                    to=[conversation.participant_identifier],
                    subject=conversation.subject or "(no subject)",
                    body_html=body,
                    user=user,
                )
        elif channel == CHANNEL_WHATSAPP:
            from whatsapp.models import WhatsAppAccount
            from whatsapp.services import send_message

            account = WhatsAppAccount.objects.filter(
                tenant=conversation.tenant, is_active=True
            ).first()
            if account is not None:
                send_message(account=account, to=conversation.participant_identifier, body=body)
        elif channel == CHANNEL_LIVECHAT:
            from livechat.models import ChatSession
            from livechat.services import send_message as chat_send

            try:
                session = ChatSession.objects.get(pk=int(conversation.external_id))
            except (ValueError, ChatSession.DoesNotExist):
                session = None
            if session is not None:
                chat_send(session=session, sender="agent", body=body)
        elif channel == CHANNEL_SOCIAL:
            from social.models import SocialMention
            from social.services import respond_to_mention

            try:
                mention = SocialMention.objects.get(pk=int(conversation.external_id))
            except (ValueError, SocialMention.DoesNotExist):
                mention = None
            if mention is not None:
                respond_to_mention(mention, body)
        elif channel in (CHANNEL_TELEPHONY, CHANNEL_SMS):
            # Voice / SMS replies are out-of-scope for the unified inbox —
            # log only. (SMS could be dispatched via telephony.services.send_sms.)
            log.info(
                "inbox.send_reply: channel %s reply skipped for conversation %s",
                channel,
                conversation.pk,
            )
    except Exception:  # pragma: no cover — defensive
        log.exception(
            "inbox.send_reply: channel %s dispatch failed for conversation %s",
            channel,
            conversation.pk,
        )


###############################################################################
# Assignment / merge
###############################################################################


def assign_conversation(conversation: UnifiedConversation, user: "User") -> UnifiedConversation:
    """Assign ``conversation`` to ``user``."""
    conversation.assigned_to = user
    conversation.save(update_fields=["assigned_to", "updated_at"])
    return conversation


def merge_conversations(
    source: UnifiedConversation, target: UnifiedConversation
) -> UnifiedConversation:
    """Merge ``source`` into ``target``.

    Re-parents every :class:`UnifiedMessage` from ``source`` to ``target``,
    flips ``source.is_merged=True`` + ``source.merged_into=target``, and
    recomputes ``target.message_count`` / ``target.last_message_at``.
    """
    if source.pk == target.pk:
        raise ValueError("merge_conversations: cannot merge a conversation into itself.")
    with transaction.atomic():
        UnifiedMessage.objects.filter(conversation=source).update(conversation=target)
        target.message_count = UnifiedMessage.objects.filter(conversation=target).count()
        last = UnifiedMessage.objects.filter(conversation=target).order_by("-timestamp").first()
        if last is not None:
            target.last_message_at = last.timestamp
        target.save(update_fields=["message_count", "last_message_at", "updated_at"])
        source.is_merged = True
        source.merged_into = target
        source.status = STATUS_CLOSED
        source.save(
            update_fields=["is_merged", "merged_into", "status", "updated_at"]
        )
    return target


###############################################################################
# SLA monitoring
###############################################################################


def check_sla_breaches() -> dict[str, Any]:
    """Sweep every open / pending conversation and flag SLA breaches.

    Returns counts of response-SLA and resolution-SLA breaches. The
    notifications app dispatches the actual alerts based on these flags
    (TODO: write a ``sla_breached`` boolean column or audit row — for
    now this is informational only).
    """
    now = timezone.now()
    response_breaches = UnifiedConversation.objects.filter(
        status__in=[STATUS_OPEN, "pending"],
        sla_response_deadline__isnull=False,
        sla_response_deadline__lt=now,
    ).count()
    resolution_breaches = UnifiedConversation.objects.filter(
        status__in=[STATUS_OPEN, "pending"],
        sla_resolution_deadline__isnull=False,
        sla_resolution_deadline__lt=now,
    ).count()
    return {
        "response_breaches": response_breaches,
        "resolution_breaches": resolution_breaches,
    }


###############################################################################
# Analytics
###############################################################################


def get_analytics(filters: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return aggregate analytics for the inbox.

    Computes: average first-response time, average resolution time,
    CSAT proxy (resolved-conversation ratio), and channel distribution.
    The CSAT proxy is a placeholder — the real CSAT comes from
    :class:`livechat.models.ChatSession.satisfaction_score` and any
    future per-channel CSAT fields.
    """
    qs = get_conversations(filters)
    total = qs.count()
    by_channel = list(
        qs.values("channel").annotate(count=Count("id")).order_by("-count")
    )
    resolved = qs.filter(status__in=[STATUS_RESOLVED, STATUS_CLOSED]).count()
    csat_proxy = (resolved / total) if total else 0.0

    # Avg response time: difference between conversation.created_at and the
    # first agent message timestamp (across conversations that have one).
    avg_response_secs: float | None = None
    avg_resolution_secs: float | None = None
    if total:
        agent_first_msgs = []
        resolution_durations = []
        for conv in qs.iterator():
            first_agent = (
                UnifiedMessage.objects.filter(
                    conversation=conv, sender=SENDER_AGENT
                )
                .order_by("timestamp")
                .first()
            )
            if first_agent is not None:
                agent_first_msgs.append(
                    (first_agent.timestamp - conv.created_at).total_seconds()
                )
            if conv.status in (STATUS_RESOLVED, STATUS_CLOSED):
                last_msg = (
                    UnifiedMessage.objects.filter(conversation=conv)
                    .order_by("-timestamp")
                    .first()
                )
                if last_msg is not None:
                    resolution_durations.append(
                        (last_msg.timestamp - conv.created_at).total_seconds()
                    )
        if agent_first_msgs:
            avg_response_secs = sum(agent_first_msgs) / len(agent_first_msgs)
        if resolution_durations:
            avg_resolution_secs = sum(resolution_durations) / len(resolution_durations)

    daily_volume = list(
        qs.annotate(day=TruncDate("last_message_at"))
        .values("day")
        .annotate(count=Count("id"))
        .order_by("day")
    )
    return {
        "total_conversations": total,
        "resolved_conversations": resolved,
        "csat_proxy": round(csat_proxy, 3),
        "avg_first_response_seconds": avg_response_secs,
        "avg_resolution_seconds": avg_resolution_secs,
        "channel_distribution": by_channel,
        "daily_volume": daily_volume,
    }


###############################################################################
# Macros
###############################################################################


def execute_macro(
    macro_id: int,
    conversation_id: int,
    *,
    user: "User | None" = None,
) -> dict[str, Any]:
    """Execute every action in ``macro`` against ``conversation``."""
    from .models import InboxMacro  # noqa: PLC0415

    macro = InboxMacro.objects.get(pk=macro_id)
    conversation = UnifiedConversation.objects.get(pk=conversation_id)
    applied: list[dict[str, Any]] = []
    for action in macro.actions or []:
        if not isinstance(action, dict):
            continue
        action_type = action.get("type")
        params = action.get("params") or {}
        result = _apply_macro_action(conversation, action_type, params, user)
        applied.append({"type": action_type, "ok": result})
    return {"macro_id": macro.pk, "conversation_id": conversation.pk, "applied": applied}


def _apply_macro_action(
    conversation: UnifiedConversation,
    action_type: str,
    params: dict[str, Any],
    user: "User | None",
) -> bool:
    """Apply a single macro action — returns ``True`` on success."""
    if action_type == "assign":
        from api.models import User  # noqa: PLC0415

        target = User.objects.filter(pk=params.get("user_id")).first()
        if target is None:
            return False
        assign_conversation(conversation, target)
        return True
    if action_type == "set_status":
        conversation.status = params.get("status", conversation.status)
        conversation.save(update_fields=["status", "updated_at"])
        return True
    if action_type == "set_priority":
        conversation.priority = params.get("priority", PRIORITY_NORMAL)
        conversation.save(update_fields=["priority", "updated_at"])
        return True
    if action_type == "add_tag":
        tags = list(conversation.tags or [])
        tag = params.get("tag")
        if tag and tag not in tags:
            tags.append(tag)
            conversation.tags = tags
            conversation.save(update_fields=["tags", "updated_at"])
        return True
    if action_type == "send_reply":
        body = params.get("body", "")
        if not body:
            return False
        send_reply(conversation, body, user=user)
        return True
    if action_type == "add_internal_note":
        notes = list(conversation.internal_notes or [])
        notes.append(
            {
                "author": user.pk if user else None,
                "body": params.get("body", ""),
                "timestamp": timezone.now().isoformat(),
            }
        )
        conversation.internal_notes = notes
        conversation.save(update_fields=["internal_notes", "updated_at"])
        return True
    return False


__all__ = [
    "assign_conversation",
    "check_sla_breaches",
    "execute_macro",
    "get_analytics",
    "get_conversations",
    "merge_conversations",
    "send_reply",
]
