"""Model-layer tests for the whatsapp app."""

from __future__ import annotations

import pytest

from whatsapp.factories import (
    WhatsAppAccountFactory,
    WhatsAppMessageFactory,
    WhatsAppTemplateFactory,
)
from whatsapp.models import WhatsAppMessage, WhatsAppTemplate


pytestmark = pytest.mark.django_db


def test_account_defaults_and_str(active_tenant, user):  # type: ignore[no-untyped-def]
    account = WhatsAppAccountFactory(tenant=active_tenant, display_phone_number="+15551234567")
    assert account.is_verified is True
    assert account.is_active is True
    assert account.quality_rating == "green"
    assert "+15551234567" in str(account)


def test_message_factory_creates_outbound_sent(active_tenant, user):  # type: ignore[no-untyped-def]
    msg = WhatsAppMessageFactory(tenant=active_tenant)
    assert msg.direction == "outbound"
    assert msg.status == "sent"
    assert msg.message_type == "text"
    assert WhatsAppMessage.objects.filter(tenant=active_tenant).count() == 1


def test_template_unique_per_tenant_name_language(active_tenant, user):  # type: ignore[no-untyped-def]
    WhatsAppTemplateFactory(tenant=active_tenant, name="welcome", language="en_US")
    with pytest.raises(Exception):  # noqa: PT011 — IntegrityError
        WhatsAppTemplateFactory(tenant=active_tenant, name="welcome", language="en_US")
    assert WhatsAppTemplate.objects.filter(tenant=active_tenant).count() == 1


def test_message_str_contains_direction_and_type(active_tenant, user):  # type: ignore[no-untyped-def]
    msg = WhatsAppMessageFactory(tenant=active_tenant)
    s = str(msg)
    assert "outbound" in s
    assert "text" in s
