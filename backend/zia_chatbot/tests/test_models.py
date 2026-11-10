"""Model-layer tests for the zia_chatbot app."""

from __future__ import annotations

import pytest

from zia_chatbot.models import SYSTEM_PROMPT, ZiaConversation


pytestmark = pytest.mark.django_db


def test_conversation_defaults_and_str(active_tenant, user):  # type: ignore[no-untyped-def]
    convo = ZiaConversation.objects.create(tenant=active_tenant, user=user)
    assert convo.messages == []
    assert "Zia" in str(convo)
    assert "CRM" in SYSTEM_PROMPT


def test_conversation_unique_per_tenant_user(active_tenant, user):  # type: ignore[no-untyped-def]
    ZiaConversation.objects.create(tenant=active_tenant, user=user)
    with pytest.raises(Exception):  # noqa: PT011
        ZiaConversation.objects.create(tenant=active_tenant, user=user)
