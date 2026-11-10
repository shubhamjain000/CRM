"""DRF serializers for the nlp_queries app."""

from __future__ import annotations

from rest_framework import serializers

from .models import NLPQuery


class NLPQuerySerializer(serializers.ModelSerializer):
    """Serializer for :class:`NLPQuery`."""

    user_email = serializers.CharField(source="user.email", read_only=True, default="")

    class Meta:
        model = NLPQuery
        fields = [
            "id",
            "user",
            "user_email",
            "question",
            "generated_spec",
            "result_summary",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "user",
            "user_email",
            "generated_spec",
            "result_summary",
            "created_at",
            "updated_at",
        ]


__all__ = ["NLPQuerySerializer"]
