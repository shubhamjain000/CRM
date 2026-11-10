"""Service-layer tests for the livechat app."""

from __future__ import annotations

import pytest

from livechat.factories import ChatSessionFactory
from livechat.models import ChatMessage
from livechat.services import (
    assign_session,
    convert_to_lead,
    create_session,
    end_session,
    send_message,
)


pytestmark = pytest.mark.django_db


def test_create_session_persists_visitor_data(active_tenant, user):  # type: ignore[no-untyped-def]
    session = create_session(
        {
            "visitor_id": "v-1",
            "visitor_name": "Alice",
            "visitor_email": "alice@example.com",
            "visitor_phone": "+15551234567",
            "pages_visited": ["/", "/pricing"],
            "referrer": "https://google.com",
        },
        tenant=active_tenant,
    )
    assert session.status == "waiting"
    assert session.visitor_email == "alice@example.com"
    assert "/pricing" in session.pages_visited


def test_assign_session_flips_status_to_active(active_tenant, user):  # type: ignore[no-untyped-def]
    session = ChatSessionFactory(tenant=active_tenant)
    assign_session(session, user)
    session.refresh_from_db()
    assert session.status == "active"
    assert session.assigned_to_id == user.pk


def test_end_session_records_satisfaction_and_transcript(active_tenant, user):  # type: ignore[no-untyped-def]
    session = ChatSessionFactory(tenant=active_tenant)
    send_message(session=session, sender="visitor", body="Hi")
    send_message(session=session, sender="agent", body="Hello!")
    end_session(session, satisfaction=5)
    session.refresh_from_db()
    assert session.status == "ended"
    assert session.ended_at is not None
    assert session.satisfaction_score == 5
    assert "visitor: Hi" in session.transcript
    assert "agent: Hello!" in session.transcript


def test_send_message_validates_sender_and_body(active_tenant, user):  # type: ignore[no-untyped-def]
    session = ChatSessionFactory(tenant=active_tenant)
    with pytest.raises(ValueError):
        send_message(session=session, sender="customer", body="x")
    with pytest.raises(ValueError):
        send_message(session=session, sender="agent", body="")


def test_convert_to_lead_requires_email_or_phone(active_tenant, user):  # type: ignore[no-untyped-def]
    session = ChatSessionFactory(
        tenant=active_tenant, visitor_email="", visitor_phone="", visitor_name=""
    )
    with pytest.raises(ValueError):
        convert_to_lead(session)


def test_convert_to_lead_creates_lead_and_links_session(active_tenant, user):  # type: ignore[no-untyped-def]
    from leads.models import Lead

    session = ChatSessionFactory(
        tenant=active_tenant,
        visitor_email="alice@example.com",
        visitor_phone="+15551234567",
        visitor_name="Alice Acme",
        assigned_to=user,
    )
    lead = convert_to_lead(session)
    assert isinstance(lead, Lead)
    assert lead.first_name == "Alice"
    assert lead.last_name == "Acme"
    assert any(e.get("email") == "alice@example.com" for e in lead.emails)
    session.refresh_from_db()
    assert session.related_module == "leads"
    assert session.related_id == str(lead.pk)


def test_send_message_persists_row(active_tenant, user):  # type: ignore[no-untyped-def]
    session = ChatSessionFactory(tenant=active_tenant)
    msg = send_message(session=session, sender="bot", body="Welcome!")
    assert msg.sender == "bot"
    assert msg.body == "Welcome!"
    assert msg.is_read is True  # bot/agent messages are auto-read
    assert ChatMessage.objects.filter(session=session).count() == 1
