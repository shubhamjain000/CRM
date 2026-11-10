"""factory_boy factories for the livechat app."""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant
from livechat.models import (
    ChatMessage,
    ChatSession,
    CannedResponse,
    ProactiveRule,
    SENDER_VISITOR,
    STATUS_WAITING,
)


class ChatSessionFactory(DjangoModelFactory):
    """Factory for :class:`ChatSession`."""

    class Meta:
        model = ChatSession

    tenant = factory.LazyFunction(_current_tenant)
    visitor_id = factory.Sequence(lambda n: f"visitor-{n}")
    visitor_name = factory.Faker("name")
    visitor_email = factory.Sequence(lambda n: f"visitor{n}@example.com")
    visitor_phone = "+15551234567"
    visitor_user_agent = "Mozilla/5.0"
    pages_visited = factory.LazyFunction(lambda: ["/", "/pricing"])
    referrer = "https://google.com/"
    status = STATUS_WAITING


class ChatMessageFactory(DjangoModelFactory):
    """Factory for :class:`ChatMessage`."""

    class Meta:
        model = ChatMessage

    tenant = factory.LazyFunction(_current_tenant)
    session = factory.SubFactory(ChatSessionFactory)
    sender = SENDER_VISITOR
    body = factory.Sequence(lambda n: f"Hello {n}")
    attachments = factory.LazyFunction(lambda: [])
    is_read = False


class CannedResponseFactory(DjangoModelFactory):
    """Factory for :class:`CannedResponse`."""

    class Meta:
        model = CannedResponse

    tenant = factory.LazyFunction(_current_tenant)
    key = factory.Sequence(lambda n: f"greeting_{n}")
    body = "Hi! How can I help you today?"
    category = "greeting"


class ProactiveRuleFactory(DjangoModelFactory):
    """Factory for :class:`ProactiveRule`."""

    class Meta:
        model = ProactiveRule

    tenant = factory.LazyFunction(_current_tenant)
    name = factory.Sequence(lambda n: f"Rule {n}")
    conditions = factory.LazyFunction(lambda: [{"field": "page", "op": "eq", "value": "/pricing"}])
    message = "Want a demo of our pricing?"
    is_active = True


__all__ = [
    "CannedResponseFactory",
    "ChatMessageFactory",
    "ChatSessionFactory",
    "ProactiveRuleFactory",
]
