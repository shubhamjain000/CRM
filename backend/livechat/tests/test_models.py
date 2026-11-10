"""Model-layer tests for the livechat app."""

from __future__ import annotations

import pytest

from livechat.factories import (
    CannedResponseFactory,
    ChatMessageFactory,
    ChatSessionFactory,
    ProactiveRuleFactory,
)
from livechat.models import ChatMessage, ChatSession, CannedResponse, ProactiveRule


pytestmark = pytest.mark.django_db


def test_chat_session_defaults(active_tenant, user):  # type: ignore[no-untyped-def]
    session = ChatSessionFactory(tenant=active_tenant, visitor_id="v-1")
    assert session.status == "waiting"
    assert session.assigned_to is None
    assert session.ended_at is None
    assert "ChatSession" in str(session)


def test_chat_message_session_indexing(active_tenant, user):  # type: ignore[no-untyped-def]
    session = ChatSessionFactory(tenant=active_tenant)
    msg = ChatMessageFactory(tenant=active_tenant, session=session, sender="visitor")
    assert msg.sender == "visitor"
    assert msg.is_read is False
    assert ChatMessage.objects.filter(session=session).count() == 1


def test_canned_response_unique_per_tenant_key(active_tenant, user):  # type: ignore[no-untyped-def]
    CannedResponseFactory(tenant=active_tenant, key="greeting")
    with pytest.raises(Exception):  # noqa: PT011 — IntegrityError
        CannedResponseFactory(tenant=active_tenant, key="greeting")
    assert CannedResponse.objects.filter(tenant=active_tenant).count() == 1


def test_proactive_rule_factory_defaults(active_tenant, user):  # type: ignore[no-untyped-def]
    rule = ProactiveRuleFactory(tenant=active_tenant)
    assert rule.is_active is True
    assert isinstance(rule.conditions, list)
    assert ProactiveRule.objects.filter(tenant=active_tenant).count() == 1
