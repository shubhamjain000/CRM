"""Service-layer tests for the telephony app."""

from __future__ import annotations

import pytest

from telephony.factories import (
    PhoneNumberFactory,
    SmsTemplateFactory,
    TelephonyCallFactory,
)
from telephony.models import SmsMessage, TelephonyCall
from telephony.services import (
    get_call_analytics,
    handle_inbound_call,
    initiate_call,
    is_valid_number,
    normalize_number,
    send_bulk_sms,
    send_sms,
    transcribe_call,
)


pytestmark = pytest.mark.django_db


def test_initiate_call_creates_outbound_call(active_tenant, user):  # type: ignore[no-untyped-def]
    PhoneNumberFactory(tenant=active_tenant, number="+15550000001", is_active=True)
    call = initiate_call(
        from_number="+15550000001",
        to_number="+15550000002",
        tenant=active_tenant,
        owner_id=str(user.pk),
    )
    assert call.direction == "outbound"
    assert call.status == "ringing"
    assert call.to_number == "+15550000002"
    assert call.owner_id == str(user.pk)


def test_initiate_call_rejects_invalid_number(active_tenant, user):  # type: ignore[no-untyped-def]
    PhoneNumberFactory(tenant=active_tenant, number="+15550000001")
    with pytest.raises(ValueError):
        initiate_call(
            from_number="+15550000001",
            to_number="not-a-number",
            tenant=active_tenant,
        )


def test_handle_inbound_call_marks_inbound_direction(active_tenant, user):  # type: ignore[no-untyped-def]
    PhoneNumberFactory(tenant=active_tenant, number="+15550000010", is_active=True)
    call = handle_inbound_call(
        from_number="+15550000001",
        to_number="+15550000010",
        call_sid="CA_INBOUND_1",
        tenant=active_tenant,
    )
    assert call.direction == "inbound"
    assert call.voip_call_id == "CA_INBOUND_1"


def test_send_sms_blocks_unapproved_template(active_tenant, user):  # type: ignore[no-untyped-def]
    PhoneNumberFactory(tenant=active_tenant, number="+15550000001")
    template = SmsTemplateFactory(tenant=active_tenant, is_approved=False)
    with pytest.raises(PermissionError):
        send_sms(
            from_number="+15550000001",
            to_number="+15550000002",
            body="",
            tenant=active_tenant,
            template=template,
        )


def test_send_sms_with_approved_template_renders_variables(active_tenant, user):  # type: ignore[no-untyped-def]
    PhoneNumberFactory(tenant=active_tenant, number="+15550000001")
    template = SmsTemplateFactory(
        tenant=active_tenant,
        is_approved=True,
        body="Hi {{name}} — your code is {{code}}.",
    )
    msg = send_sms(
        from_number="+15550000001",
        to_number="+15550000002",
        body="",
        tenant=active_tenant,
        template=template,
        variables={"name": "Alice", "code": "1234"},
    )
    assert msg.body == "Hi Alice — your code is 1234."
    assert msg.template_id == template.pk


def test_send_bulk_sms_returns_counts(active_tenant, user):  # type: ignore[no-untyped-def]
    PhoneNumberFactory(tenant=active_tenant, number="+15550000001")
    template = SmsTemplateFactory(
        tenant=active_tenant,
        is_approved=True,
        body="Hello {{name}}",
    )
    recipients = [
        {"to": "+15550000002", "variables": {"name": "Alice"}},
        {"to": "+15550000003", "variables": {"name": "Bob"}},
        {"to": "", "variables": {}},  # invalid — should count as failed
    ]
    result = send_bulk_sms(
        template_id=template.pk,
        recipients=recipients,
        from_number="+15550000001",
        tenant=active_tenant,
    )
    assert result["sent"] == 2
    assert result["failed"] == 1


def test_get_call_analytics_empty_tenant_returns_zeros(active_tenant, user):  # type: ignore[no-untyped-def]
    out = get_call_analytics({})
    assert out["total_calls"] == 0
    assert out["answer_rate"] == 0.0
    assert out["peak_hours"] == {}


def test_get_call_analytics_aggregates_calls(active_tenant, user):  # type: ignore[no-untyped-def]
    TelephonyCallFactory.create_batch(
        3,
        tenant=active_tenant,
        direction="outbound",
        status="completed",
        duration=120,
        owner_id=str(user.pk),
        outcome="connected",
    )
    TelephonyCallFactory(
        tenant=active_tenant,
        direction="missed",
        status="failed",
        duration=0,
        outcome="",  # missed calls have no outcome
    )
    out = get_call_analytics({})
    assert out["total_calls"] == 4
    assert out["missed_calls"] == 1
    assert out["answer_rate"] == pytest.approx(3 / 4, rel=1e-3)
    assert out["avg_duration"] == pytest.approx((120 * 3) / 4, rel=1e-3)
    assert out["volume_per_owner"].get(str(user.pk)) == 3
    assert out["outcome_distribution"].get("connected") == 3


def test_transcribe_call_updates_transcription_and_sentiment(active_tenant, user):  # type: ignore[no-untyped-def]
    # Inject a stub transcription by monkey-patching the provider hook.
    import telephony.services as svc

    call = TelephonyCallFactory(
        tenant=active_tenant, recording_url="https://example.com/rec.wav"
    )
    original = svc._provider_transcribe

    def _stub(_url):  # noqa: ANN001
        return "This was a great call, thanks!"

    svc._provider_transcribe = _stub
    try:
        transcribe_call(call.pk)
    finally:
        svc._provider_transcribe = original
    call.refresh_from_db()
    assert "great" in call.transcription
    assert call.sentiment == "positive"


def test_normalize_and_validate_number_helpers():  # type: ignore[no-untyped-def]
    assert normalize_number("+1 (555) 000-0001") == "+15550000001"
    assert is_valid_number("+15550000001") is True
    assert is_valid_number("abc") is False
