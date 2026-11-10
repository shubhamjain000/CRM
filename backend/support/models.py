"""Database models for the support app (Phase 19).

Three tenant-scoped models: :class:`Ticket`, :class:`TicketReply`, and
:class:`KnowledgeBaseArticle`.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

from api.models import TenantModel

# Ticket status
T_OPEN = "open"
T_PENDING = "pending"
T_RESOLVED = "resolved"
T_CLOSED = "closed"
TICKET_STATUS_CHOICES = [
    (T_OPEN, "open"),
    (T_PENDING, "pending"),
    (T_RESOLVED, "resolved"),
    (T_CLOSED, "closed"),
]

# Ticket priority
P_LOW = "low"
P_NORMAL = "normal"
P_HIGH = "high"
P_URGENT = "urgent"
TICKET_PRIORITY_CHOICES = [
    (P_LOW, "low"),
    (P_NORMAL, "normal"),
    (P_HIGH, "high"),
    (P_URGENT, "urgent"),
]


class Ticket(TenantModel):
    """A tenant-scoped support ticket."""

    subject = models.CharField(max_length=255, db_index=True)
    description = models.TextField(blank=True, default="")
    status = models.CharField(
        max_length=16, choices=TICKET_STATUS_CHOICES, default=T_OPEN, db_index=True
    )
    priority = models.CharField(
        max_length=16, choices=TICKET_PRIORITY_CHOICES, default=P_NORMAL, db_index=True
    )
    category = models.CharField(max_length=64, blank=True, default="", db_index=True)
    requester_name = models.CharField(max_length=255, blank=True, default="")
    requester_email = models.EmailField(blank=True, default="")
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_tickets",
    )
    sla_deadline = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        db_table = "support_ticket"
        verbose_name = "ticket"
        verbose_name_plural = "tickets"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "status"], name="tk_status_idx"),
            models.Index(fields=["tenant", "priority"], name="tk_prio_idx"),
        ]

    def __str__(self) -> str:
        return f"Ticket #{self.pk}: {self.subject}"


class TicketReply(TenantModel):
    """A reply on a :class:`Ticket`; ``is_internal`` marks private notes."""

    ticket = models.ForeignKey(
        Ticket,
        on_delete=models.CASCADE,
        related_name="replies",
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ticket_replies",
    )
    body = models.TextField(blank=True, default="")
    is_internal = models.BooleanField(default=False)

    class Meta:
        db_table = "support_ticketreply"
        verbose_name = "ticket reply"
        verbose_name_plural = "ticket replies"
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["tenant", "ticket"], name="tr_ticket_idx"),
        ]

    def __str__(self) -> str:
        return f"Reply on Ticket #{self.ticket_id} by {self.author_id}"


class KnowledgeBaseArticle(TenantModel):
    """A tenant-scoped KB article with view + helpful counters."""

    title = models.CharField(max_length=255, db_index=True)
    content = models.TextField(blank=True, default="")
    category = models.CharField(max_length=64, blank=True, default="", db_index=True)
    views = models.PositiveIntegerField(default=0)
    helpful = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "support_knowledgebasearticle"
        verbose_name = "knowledge base article"
        verbose_name_plural = "knowledge base articles"
        ordering = ["-views", "-created_at"]
        indexes = [
            models.Index(fields=["tenant", "category"], name="kb_cat_idx"),
        ]

    def __str__(self) -> str:
        return f"KB: {self.title}"


__all__ = [
    "Ticket",
    "TicketReply",
    "KnowledgeBaseArticle",
    "T_OPEN",
    "T_PENDING",
    "T_RESOLVED",
    "T_CLOSED",
    "TICKET_STATUS_CHOICES",
    "P_LOW",
    "P_NORMAL",
    "P_HIGH",
    "P_URGENT",
    "TICKET_PRIORITY_CHOICES",
]
