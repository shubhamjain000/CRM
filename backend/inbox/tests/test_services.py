"""Service-layer tests for the unified inbox app."""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from inbox.factories import (
    UnifiedAgentMessageFactory,
    UnifiedConversationFactory,
    UnifiedMessageFactory,
)
from inbox.models import InboxMacro, UnifiedMessage
from inbox.services import (
    assign_conversation,
    check_sla_breaches,
    execute_macro,
    get_analytics,
    get_conversations,
    merge_conversations,
    send_reply,
)


pytestmark = pytest.mark.django_db


def test_send_reply_creates_unified_message_and_reopens_resolved(active_tenant, user):  # type: ignore[no-untyped-def]
    conv = UnifiedConversationFactory(
        tenant=active_tenant, channel="social", status="resolved", message_count=1
    )
    msg = send_reply(conv, "Following up!", user=user)
    assert msg.sender == "agent"
    conv.refresh_from_db()
    assert conv.status == "open"  # auto-reopened
    assert conv.message_count == 2


def test_send_reply_requires_body(active_tenant, user):  # type: ignore[no-untyped-def]
    conv = UnifiedConversationFactory(tenant=active_tenant, channel="email")
    with pytest.raises(ValueError):
        send_reply(conv, "")


def test_get_conversations_filters_by_channel_and_status(active_tenant, user):  # type: ignore[no-untyped-def]
    UnifiedConversationFactory(tenant=active_tenant, channel="email", status="open")
    UnifiedConversationFactory(tenant=active_tenant, channel="whatsapp", status="open")
    UnifiedConversationFactory(tenant=active_tenant, channel="email", status="closed")
    qs = get_conversations({"channel": "email", "status": "open"})
    assert qs.count() == 1
    assert qs.first().channel == "email"


def test_merge_conversations_reparents_messages(active_tenant, user):  # type: ignore[no-untyped-def]
    source = UnifiedConversationFactory(tenant=active_tenant, channel="email")
    target = UnifiedConversationFactory(tenant=active_tenant, channel="email")
    UnifiedMessageFactory(tenant=active_tenant, conversation=source, body="m1")
    UnifiedMessageFactory(tenant=active_tenant, conversation=source, body="m2")
    merge_conversations(source, target)
    source.refresh_from_db()
    target.refresh_from_db()
    assert source.is_merged is True
    assert source.merged_into_id == target.pk
    assert source.status == "closed"
    assert target.message_count == 2
    assert UnifiedMessage.objects.filter(conversation=target).count() == 2


def test_check_sla_breaches_counts_overdue(active_tenant, user):  # type: ignore[no-untyped-def]
    past = timezone.now() - timedelta(hours=1)
    UnifiedConversationFactory(
        tenant=active_tenant,
        channel="email",
        status="open",
        sla_response_deadline=past,
    )
    result = check_sla_breaches()
    assert result["response_breaches"] >= 1


def test_get_analytics_returns_expected_keys(active_tenant, user):  # type: ignore[no-untyped-def]
    conv = UnifiedConversationFactory(tenant=active_tenant, channel="email", status="open")
    UnifiedMessageFactory(tenant=active_tenant, conversation=conv)
    UnifiedAgentMessageFactory(tenant=active_tenant, conversation=conv)
    a = get_analytics({"channel": "email"})
    assert a["total_conversations"] >= 1
    assert "channel_distribution" in a
    assert "avg_first_response_seconds" in a
    assert a["csat_proxy"] >= 0.0


def test_execute_macro_applies_actions(active_tenant, user):  # type: ignore[no-untyped-def]
    conv = UnifiedConversationFactory(tenant=active_tenant, channel="email", status="open")
    macro = InboxMacro.objects.create(
        tenant=active_tenant,
        name="Resolve + tag",
        actions=[
            {"type": "set_status", "params": {"status": "resolved"}},
            {"type": "add_tag", "params": {"tag": "vip"}},
        ],
        created_by=user,
    )
    result = execute_macro(macro.pk, conv.pk, user=user)
    assert all(a["ok"] for a in result["applied"])
    conv.refresh_from_db()
    assert conv.status == "resolved"
    assert "vip" in conv.tags


def test_assign_conversation_sets_assignee(active_tenant, user):  # type: ignore[no-untyped-def]
    conv = UnifiedConversationFactory(tenant=active_tenant, channel="email", assigned_to=None)
    assign_conversation(conv, user)
    conv.refresh_from_db()
    assert conv.assigned_to_id == user.pk
