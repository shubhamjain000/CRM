"""factory_boy factories for the telephony app."""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant, _current_user
from telephony.models import (
    CALL_COMPLETED,
    CALL_OUTBOUND,
    OUTCOME_CONNECTED,
    PROVIDER_TWILIO,
    SMS_SENT,
    SMS_TRANSACTIONAL,
    IvrFlow,
    PhoneNumber,
    SmsMessage,
    SmsTemplate,
    TelephonyCall,
)


class PhoneNumberFactory(DjangoModelFactory):
    """Factory for :class:`PhoneNumber`."""

    class Meta:
        model = PhoneNumber

    tenant = factory.LazyFunction(_current_tenant)
    number = factory.Sequence(lambda n: f"+1555000{n:03d}")
    provider = PROVIDER_TWILIO
    capabilities = factory.LazyFunction(lambda: {"voice": True, "sms": True, "mms": False, "whatsapp": False})
    is_active = True
    region = "US"
    assigned_to_type = ""
    assigned_to_id = ""
    friendly_name = ""


class TelephonyCallFactory(DjangoModelFactory):
    """Factory for :class:`TelephonyCall`.

    Defaults: ``direction=outbound``, ``status=completed``, durations in
    seconds, ``voip_provider=twilio``.
    """

    class Meta:
        model = TelephonyCall

    tenant = factory.LazyFunction(_current_tenant)
    from_number = "+15550000001"
    to_number = "+15550000002"
    direction = CALL_OUTBOUND
    status = CALL_COMPLETED
    duration = 60
    recording_url = ""
    transcription = ""
    sentiment = ""
    related_module = ""
    related_id = ""
    owner_id = ""
    voip_provider = PROVIDER_TWILIO
    voip_call_id = factory.Sequence(lambda n: f"CA{n:016d}")
    outcome = OUTCOME_CONNECTED


class SmsTemplateFactory(DjangoModelFactory):
    """Factory for :class:`SmsTemplate`.

    Defaults: ``category=transactional``, ``is_approved=False`` (DLT gate
    closed), ``max_length=160``.
    """

    class Meta:
        model = SmsTemplate

    tenant = factory.LazyFunction(_current_tenant)
    name = factory.Sequence(lambda n: f"Template {n}")
    body = "Hello {{name}}, your code is {{code}}."
    variables = factory.LazyFunction(lambda: ["name", "code"])
    category = SMS_TRANSACTIONAL
    is_approved = False
    dlt_template_id = ""
    max_length = 160


class SmsMessageFactory(DjangoModelFactory):
    """Factory for :class:`SmsMessage`."""

    class Meta:
        model = SmsMessage

    tenant = factory.LazyFunction(_current_tenant)
    from_number = "+15550000001"
    to_number = "+15550000002"
    body = "Hello world"
    direction = "outbound"
    status = SMS_SENT
    template = None
    segments = 1
    cost = "0.0050"


class IvrFlowFactory(DjangoModelFactory):
    """Factory for :class:`IvrFlow`."""

    class Meta:
        model = IvrFlow

    tenant = factory.LazyFunction(_current_tenant)
    name = factory.Sequence(lambda n: f"IVR Flow {n}")
    config = factory.LazyFunction(
        lambda: {
            "greeting": "Welcome to Acme. Press 1 for sales, 2 for support.",
            "menus": [
                {"key": "1", "route_to": {"type": "user", "id": "1"}},
                {"key": "2", "route_to": {"type": "queue", "id": "support"}},
            ],
        }
    )
    phone_number = None
    is_active = True


__all__ = [
    "IvrFlowFactory",
    "PhoneNumberFactory",
    "SmsMessageFactory",
    "SmsTemplateFactory",
    "TelephonyCallFactory",
]
