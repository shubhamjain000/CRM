"""factory_boy factories for the email_integration app."""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant, _current_user
from email_integration.models import (
    DIRECTION_INBOUND,
    PROVIDER_IMAP,
    STATUS_SENT,
    Email,
    EmailAccount,
    EmailSignature,
    EmailThread,
    EmailTracking,
    MailMergeCampaign,
    TRACK_OPEN,
)


class EmailAccountFactory(DjangoModelFactory):
    """Factory for :class:`EmailAccount`."""

    class Meta:
        model = EmailAccount

    tenant = factory.LazyFunction(_current_tenant)
    user = factory.LazyFunction(_current_user)
    provider = PROVIDER_IMAP
    email_address = factory.Sequence(lambda n: f"inbox-{n}@example.com")
    credentials = factory.LazyFunction(lambda: {})
    sync_enabled = True
    sync_frequency = 2
    is_active = True


class EmailThreadFactory(DjangoModelFactory):
    """Factory for :class:`EmailThread`."""

    class Meta:
        model = EmailThread

    tenant = factory.LazyFunction(_current_tenant)
    subject = factory.Sequence(lambda n: f"Thread {n}")
    related_module = ""
    related_id = ""
    email_count = 0


class EmailFactory(DjangoModelFactory):
    """Factory for :class:`Email`.

    Defaults: ``direction=inbound``, ``status=sent``, ``from_address`` set,
    ``to_addresses=[...]``, ``subject`` populated.
    """

    class Meta:
        model = Email

    tenant = factory.LazyFunction(_current_tenant)
    account = factory.SubFactory(EmailAccountFactory)
    thread = None
    message_id = factory.Sequence(lambda n: f"<msg-{n}@foundation.local>")
    from_address = "alice@example.com"
    to_addresses = factory.LazyFunction(lambda: ["bob@example.com"])
    cc = factory.LazyFunction(lambda: [])
    bcc = factory.LazyFunction(lambda: [])
    subject = factory.Sequence(lambda n: f"Subject {n}")
    body_html = "<p>Hello</p>"
    body_text = "Hello"
    attachments = factory.LazyFunction(lambda: [])
    direction = DIRECTION_INBOUND
    status = STATUS_SENT
    is_starred = False
    is_important = False
    has_attachments = False
    labels = factory.LazyFunction(lambda: [])


class EmailSignatureFactory(DjangoModelFactory):
    """Factory for :class:`EmailSignature`."""

    class Meta:
        model = EmailSignature

    tenant = factory.LazyFunction(_current_tenant)
    user = factory.LazyFunction(_current_user)
    name = factory.Sequence(lambda n: f"Signature {n}")
    body_html = "<p>— Me</p>"
    is_default = False


class EmailTrackingFactory(DjangoModelFactory):
    """Factory for :class:`EmailTracking`."""

    class Meta:
        model = EmailTracking

    tenant = factory.LazyFunction(_current_tenant)
    email = factory.SubFactory(EmailFactory)
    event = TRACK_OPEN
    url = ""
    user_agent = "Mozilla/5.0"


class MailMergeCampaignFactory(DjangoModelFactory):
    """Factory for :class:`MailMergeCampaign`."""

    class Meta:
        model = MailMergeCampaign

    tenant = factory.LazyFunction(_current_tenant)
    name = factory.Sequence(lambda n: f"Campaign {n}")
    template_subject = "Hello {{name}}"
    template_body_html = "<p>Hi {{name}},</p>"
    recipients = factory.LazyFunction(
        lambda: [{"email": "alice@example.com", "variables": {"name": "Alice"}}]
    )
    status = "draft"
    created_by = factory.LazyFunction(_current_user)


__all__ = [
    "EmailAccountFactory",
    "EmailFactory",
    "EmailSignatureFactory",
    "EmailThreadFactory",
    "EmailTrackingFactory",
    "MailMergeCampaignFactory",
]
