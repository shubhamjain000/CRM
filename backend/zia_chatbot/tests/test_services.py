"""Service-layer tests for the zia_chatbot app."""

from __future__ import annotations

from zia_chatbot.models import ZiaConversation
from zia_chatbot.services import chat, clear_history, get_history


pytestmark = pytest.mark.django_db


def test_chat_appends_user_and_assistant_messages(active_tenant, user):  # type: ignore[no-untyped-def]
    response = chat(user, "Hello Zia!")
    assert "content" in response
    convo = ZiaConversation.objects.get(tenant=active_tenant, user=user)
    assert len(convo.messages) == 2  # user + assistant
    assert convo.messages[0]["role"] == "user"
    assert convo.messages[1]["role"] == "assistant"


def test_clear_history_wipes_messages(active_tenant, user):  # type: ignore[no-untyped-def]
    chat(user, "hello")
    assert len(get_history(user).messages) == 2
    cleared = clear_history(user)
    assert cleared.messages == []
