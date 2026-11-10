"""Model-layer tests for the telephony app."""

from __future__ import annotations

import pytest

from telephony.factories import (
    IvrFlowFactory,
    PhoneNumberFactory,
    SmsMessageFactory,
    SmsTemplateFactory,
    TelephonyCallFactory,
)
from telephony.models import (
    IvrFlow,
    PhoneNumber,
    SmsMessage,
    SmsTemplate,
    TelephonyCall,
)


pytestmark = pytest.mark.django_db


def test_phone_number_defaults_and_str(active_tenant, user):  # type: ignore[no-untyped-def]
    pn = PhoneNumberFactory(tenant=active_tenant, friendly_name="Sales line")
    assert "Sales line" in str(pn)
    assert pn.provider == "twilio"
    assert pn.is_active is True
    assert pn.capabilities.get("voice") is True


def test_telephony_call_factory_and_str(active_tenant, user):  # type: ignore[no-untyped-def]
    call = TelephonyCallFactory(tenant=active_tenant, from_number="+15550000001")
    text = str(call)
    assert "outbound" in text
    assert call.status == "completed"
    assert call.outcome == "connected"
    assert call.duration == 60


def test_sms_template_dlt_defaults(active_tenant, user):  # type: ignore[no-untyped-def]
    template = SmsTemplateFactory(tenant=active_tenant, name="OTP")
    assert template.is_approved is False
    assert template.dlt_template_id == ""
    assert template.category == "transactional"
    assert template.max_length == 160
    assert "OTP" in str(template)


def test_sms_message_segments_and_str(active_tenant, user):  # type: ignore[no-untyped-def]
    msg = SmsMessageFactory(tenant=active_tenant, body="Hi")
    assert msg.segments == 1
    assert "outbound" in str(msg)


def test_ivr_flow_config_round_trip(active_tenant, user):  # type: ignore[no-untyped-def]
    ivr = IvrFlowFactory(tenant=active_tenant)
    assert ivr.config.get("greeting", "").startswith("Welcome")
    assert isinstance(ivr.config.get("menus"), list)
    assert IvrFlow.objects.filter(tenant=active_tenant).count() == 1
