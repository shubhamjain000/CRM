"""DRF serializers for the smart_suggestions app."""

from __future__ import annotations

from rest_framework import serializers

from .models import SmartSuggestion


class SmartSuggestionSerializer(serializers.ModelSerializer):
    """Serializer for :class:`SmartSuggestion`."""

    user_email = serializers.CharField(source="user.email", read_only=True, default="")

    class Meta:
        model = SmartSuggestion
        fields = [
            "id",
            "user",
            "user_email",
            "suggestion_type",
            "title",
            "description",
            "target_module",
            "target_id",
            "priority",
            "is_dismissed",
            "is_accepted",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "user",
            "user_email",
            "is_dismissed",
            "is_accepted",
            "created_at",
            "updated_at",
        ]


__all__ = ["SmartSuggestionSerializer"]
