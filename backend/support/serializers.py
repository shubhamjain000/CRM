"""DRF serializers for the support app."""

from __future__ import annotations

from rest_framework import serializers

from .models import KnowledgeBaseArticle, Ticket, TicketReply


class TicketSerializer(serializers.ModelSerializer):
    """Serializer for :class:`Ticket`."""

    assigned_to_email = serializers.CharField(
        source="assigned_to.email", read_only=True, default=""
    )

    class Meta:
        model = Ticket
        fields = [
            "id",
            "subject",
            "description",
            "status",
            "priority",
            "category",
            "requester_name",
            "requester_email",
            "assigned_to",
            "assigned_to_email",
            "sla_deadline",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class TicketReplySerializer(serializers.ModelSerializer):
    """Serializer for :class:`TicketReply`."""

    author_email = serializers.CharField(source="author.email", read_only=True, default="")

    class Meta:
        model = TicketReply
        fields = [
            "id",
            "ticket",
            "author",
            "author_email",
            "body",
            "is_internal",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "author", "author_email", "created_at", "updated_at"]


class KnowledgeBaseArticleSerializer(serializers.ModelSerializer):
    """Serializer for :class:`KnowledgeBaseArticle`."""

    class Meta:
        model = KnowledgeBaseArticle
        fields = [
            "id",
            "title",
            "content",
            "category",
            "views",
            "helpful",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "views", "helpful", "created_at", "updated_at"]


__all__ = [
    "KnowledgeBaseArticleSerializer",
    "TicketReplySerializer",
    "TicketSerializer",
]
