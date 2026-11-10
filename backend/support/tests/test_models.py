"""Model-layer tests for the support app."""

from __future__ import annotations

import pytest

from support.models import (
    KnowledgeBaseArticle,
    P_URGENT,
    T_OPEN,
    Ticket,
    TicketReply,
)


pytestmark = pytest.mark.django_db


def test_ticket_reply_and_kb_round_trip(active_tenant, user):  # type: ignore[no-untyped-def]
    ticket = Ticket.objects.create(
        tenant=active_tenant,
        subject="Login broken",
        description="Cannot log in.",
        status=T_OPEN,
        priority=P_URGENT,
        category="auth",
        requester_name="Alice",
        requester_email="alice@example.com",
        assigned_to=user,
    )
    reply = TicketReply.objects.create(
        tenant=active_tenant, ticket=ticket, author=user, body="Looking into it."
    )
    kb = KnowledgeBaseArticle.objects.create(
        tenant=active_tenant,
        title="Resetting your password",
        content="Step 1...",
        category="auth",
        views=5,
        helpful=2,
    )
    assert ticket.status == T_OPEN
    assert ticket.priority == P_URGENT
    assert reply.ticket_id == ticket.pk
    assert reply.author_id == user.pk
    assert str(kb) == "KB: Resetting your password"
    assert str(ticket).startswith(f"Ticket #{ticket.pk}: Login broken")
