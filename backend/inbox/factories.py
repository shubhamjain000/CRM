"""factory_boy factories for the unified inbox app."""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant
from inbox.models import (
    CHANNEL_EMAIL,
    SENDER_AGENT,
    SENDER_CUSTOMER,
    STATUS_OPEN,
    UnifiedConversation,
    UnifiedMessage,
)


class UnifiedConversationFactory(DjangoModelFactory):
    """Factory for :class:`UnifiedConversation`."""

    class Meta:
        model = UnifiedConversation

    tenant = factory.LazyFunction(_current_tenant)
    channel = CHANNEL_EMAIL
    external_id = factory.Sequence(lambda n: f"thread-{n}")
    subject = factory.Sequence(lambda n: f"Conversation {n}")
    participant_name = factory.Faker("name")
    participant_identifier = factory.Sequence(lambda n: f"customer{n}@example.com")
    status = STATUS_OPEN
    priority = "normal"
    tags = factory.LazyFunction(lambda: [])
    internal_notes = factory.LazyFunction(lambda: [])
    is_merged = False
    message_count = 0


class UnifiedMessageFactory(DjangoModelFactory):
    """Factory for :class:`UnifiedMessage`."""

    class Meta:
        model = UnifiedMessage

    tenant = factory.LazyFunction(_current_tenant)
    conversation = factory.SubFactory(UnifiedConversationFactory)
    channel = CHANNEL_EMAIL
    sender = SENDER_CUSTOMER
    body = factory.Sequence(lambda n: f"Message body {n}")
    attachments = factory.LazyFunction(lambda: [])
    is_read = False
    metadata = factory.LazyFunction(lambda: {})


class UnifiedAgentMessageFactory(UnifiedMessageFactory):
    """Factory for an agent reply."""

    sender = SENDER_AGENT
    is_read = True


__all__ = [
    "UnifiedAgentMessageFactory",
    "UnifiedConversationFactory",
    "UnifiedMessageFactory",
]
