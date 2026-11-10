"""factory_boy factories for the whatsapp app."""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant
from whatsapp.models import (
    DIR_INBOUND,
    DIR_OUTBOUND,
    MSG_TEXT,
    QUALITY_GREEN,
    ST_SENT,
    WhatsAppAccount,
    WhatsAppMessage,
    WhatsAppTemplate,
)


class WhatsAppAccountFactory(DjangoModelFactory):
    """Factory for :class:`WhatsAppAccount`."""

    class Meta:
        model = WhatsAppAccount

    tenant = factory.LazyFunction(_current_tenant)
    phone_number_id = factory.Sequence(lambda n: f"phone-id-{n}")
    waba_id = factory.Sequence(lambda n: f"waba-{n}")
    access_token = "secret-token"
    display_name = factory.Sequence(lambda n: f"WA Line {n}")
    display_phone_number = factory.Sequence(lambda n: f"+1555000{n:03d}")
    quality_rating = QUALITY_GREEN
    is_verified = True
    is_active = True


class WhatsAppMessageFactory(DjangoModelFactory):
    """Factory for :class:`WhatsAppMessage`."""

    class Meta:
        model = WhatsAppMessage

    tenant = factory.LazyFunction(_current_tenant)
    account = factory.SubFactory(WhatsAppAccountFactory)
    from_phone = "+15550000001"
    to_phone = "+15550000002"
    body = factory.Sequence(lambda n: f"Hello {n}")
    message_type = MSG_TEXT
    status = ST_SENT
    direction = DIR_OUTBOUND


class WhatsAppTemplateFactory(DjangoModelFactory):
    """Factory for :class:`WhatsAppTemplate`."""

    class Meta:
        model = WhatsAppTemplate

    tenant = factory.LazyFunction(_current_tenant)
    name = factory.Sequence(lambda n: f"welcome_template_{n}")
    language = "en_US"
    category = "MARKETING"
    body = "Hi {{1}}, welcome!"
    header_type = ""
    header_text = ""
    footer_text = ""
    buttons = factory.LazyFunction(lambda: [])
    is_approved = True
    template_id = factory.Sequence(lambda n: f"meta-{n}")


__all__ = [
    "WhatsAppAccountFactory",
    "WhatsAppMessageFactory",
    "WhatsAppTemplateFactory",
]
