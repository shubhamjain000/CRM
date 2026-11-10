"""Service-layer tests for the whatsapp app."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from whatsapp.factories import WhatsAppAccountFactory, WhatsAppTemplateFactory
from whatsapp.models import WhatsAppMessage
from whatsapp.services import (
    broadcast,
    handle_webhook,
    send_message,
    send_template,
)


pytestmark = pytest.mark.django_db


def _ok_response(*_args, **_kwargs):
    return {"messages": [{"id": "wamid.test"}]}


def _err_response(*_args, **_kwargs):
    return {"error": {"code": "190", "message": "Invalid token"}}


def test_send_message_creates_sent_row(active_tenant, user):  # type: ignore[no-untyped-def]
    account = WhatsAppAccountFactory(tenant=active_tenant, display_phone_number="+15551112222")
    with patch("whatsapp.services._graph_api_send", side_effect=_ok_response):
        msg = send_message(account=account, to="+15553334444", body="Hello")
    assert msg.direction == "outbound"
    assert msg.status == "sent"
    assert msg.from_phone == "+15551112222"
    assert msg.to_phone == "+15553334444"
    assert msg.body == "Hello"


def test_send_message_requires_body_or_media(active_tenant, user):  # type: ignore[no-untyped-def]
    account = WhatsAppAccountFactory(tenant=active_tenant)
    with pytest.raises(ValueError):
        send_message(account=account, to="+15553334444")


def test_send_message_failure_marks_failed(active_tenant, user):  # type: ignore[no-untyped-def]
    account = WhatsAppAccountFactory(tenant=active_tenant)
    with patch("whatsapp.services._graph_api_send", side_effect=_err_response):
        msg = send_message(account=account, to="+15553334444", body="Hi")
    assert msg.status == "failed"
    assert msg.error_code == "190"
    assert "Invalid token" in msg.error_message


def test_send_template_requires_approved_template(active_tenant, user):  # type: ignore[no-untyped-def]
    account = WhatsAppAccountFactory(tenant=active_tenant)
    # Unapproved template → service should reject.
    tmpl = WhatsAppTemplateFactory(tenant=active_tenant, name="promo", is_approved=False)
    with pytest.raises(ValueError):
        send_template(account=account, to="+15553334444", template_name=tmpl.name)
    # No template by name → also reject.
    with pytest.raises(ValueError):
        send_template(account=account, to="+15553334444", template_name="missing")


def test_broadcast_isolates_per_recipient_failure(active_tenant, user):  # type: ignore[no-untyped-def]
    account = WhatsAppAccountFactory(tenant=active_tenant)
    WhatsAppTemplateFactory(tenant=active_tenant, name="promo", is_approved=True)
    with patch("whatsapp.services._graph_api_send", side_effect=_ok_response):
        result = broadcast(
            account=account,
            recipients=["+15550000001", "+15550000002"],
            template_name="promo",
        )
    assert len(result["sent"]) == 2
    assert result["failed"] == []


def test_handle_webhook_creates_inbound_messages(active_tenant, user):  # type: ignore[no-untyped-def]
    account = WhatsAppAccountFactory(
        tenant=active_tenant, phone_number_id="ph-1", display_phone_number="+15559998888"
    )
    payload = {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "metadata": {"phone_number_id": "ph-1"},
                            "messages": [
                                {"from": "+15551110000", "type": "text", "text": {"body": "Hi"}},
                                {"from": "+15551110001", "type": "text", "text": {"body": "Bye"}},
                            ],
                            "statuses": [],
                        }
                    }
                ]
            }
        ]
    }
    created = handle_webhook(payload)
    assert len(created) == 2
    assert WhatsAppMessage.objects.filter(tenant=active_tenant, direction="inbound").count() == 2
    assert all(m.to_phone == "+15559998888" for m in created)
