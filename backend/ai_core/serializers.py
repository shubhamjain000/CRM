"""DRF serializers for the ai_core app."""

from __future__ import annotations

from rest_framework import serializers

from .models import AICostLog, PromptTemplate


class AICostLogSerializer(serializers.ModelSerializer):
    """Serializer for :class:`AICostLog` (read-only)."""

    class Meta:
        model = AICostLog
        fields = [
            "id",
            "model",
            "input_tokens",
            "output_tokens",
            "cost",
            "task_type",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "model",
            "input_tokens",
            "output_tokens",
            "cost",
            "task_type",
            "created_at",
        ]


class PromptTemplateSerializer(serializers.ModelSerializer):
    """Serializer for :class:`PromptTemplate`."""

    class Meta:
        model = PromptTemplate
        fields = [
            "id",
            "name",
            "version",
            "system_prompt",
            "user_prompt_template",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


__all__ = ["AICostLogSerializer", "PromptTemplateSerializer"]
