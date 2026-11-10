"""Model-layer tests for the unified inbox app."""

from __future__ import annotations

import pytest

from inbox.factories import UnifiedConversationFactory, UnifiedMessageFactory
from inbox.models import InboxMacro, UnifiedConversation, UnifiedMessage


pytestmark = pytest.mark.django_db


def test_conversation_defaults_and_str(active_tenant, user):  # type: ignore[no-untyped-def]
    conv = UnifiedConversationFactory(tenant=active_tenant, channel="email", external_id="t-1")
    assert conv.status == "open"
    assert conv.priority == "normal"
    assert conv.is_merged is False
    assert conv.message_count == 0
    assert "email/t-1" in str(conv)


def test_message_factory_defaults(active_tenant, user):  # type: ignore[no-untyped-def]
    conv = UnifiedConversationFactory(tenant=active_tenant)
    msg = UnifiedMessageFactory(tenant=active_tenant, conversation=conv)
    assert msg.sender == "customer"
    assert msg.is_read is False
    assert UnifiedMessage.objects.filter(conversation=conv).count() == 1


def test_conversation_unique_per_tenant_channel_external_id(active_tenant, user):  # type: ignore[no-untyped-def]
    UnifiedConversationFactory(
        tenant=active_tenant, channel="email", external_id="dup"
    )
    with pytest.raises(Exception):  # noqa: PT011 — IntegrityError
        UnifiedConversationFactory(
            tenant=active_tenant, channel="email", external_id="dup"
        )
    assert UnifiedConversation.objects.filter(tenant=active_tenant).count() == 1


def test_inbox_macro_str(active_tenant, user):  # type: ignore[no-untyped-def]
    macro = InboxMacro.objects.create(
        tenant=active_tenant,
        name="Resolve + tag",
        actions=[
            {"type": "set_status", "params": {"status": "resolved"}},
            {"type": "add_tag", "params": {"tag": "auto"}},
        ],
        created_by=user,
    )
    assert macro.name in str(macro)
    assert len(macro.actions) == 2
