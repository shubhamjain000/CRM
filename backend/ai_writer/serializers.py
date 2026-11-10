"""DRF serializers for the ai_writer app."""

from __future__ import annotations

from rest_framework import serializers

from .models import AIWriterDraft


class AIWriterDraftSerializer(serializers.ModelSerializer):
    """Serializer for :class:`AIWriterDraft`."""

    user_email = serializers.CharField(source="user.email", read_only=True, default="")

    class Meta:
        model = AIWriterDraft
        fields = [
            "id",
            "user",
            "user_email",
            "draft_type",
            "prompt",
            "generated_content",
            "style",
            "tone",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "user",
            "user_email",
            "generated_content",
            "created_at",
            "updated_at",
        ]


class GenerateEmailSerializer(serializers.Serializer):
    """Input serializer for the ``generate_email`` action."""

    prompt = serializers.CharField()
    style = serializers.CharField(required=False, default="professional")
    tone = serializers.CharField(required=False, default="friendly")

    class Meta:
        fields = ["prompt", "style", "tone"]


class GenerateSummarySerializer(serializers.Serializer):
    """Input serializer for the ``generate_summary`` action."""

    text = serializers.CharField()

    class Meta:
        fields = ["text"]


class GenerateSubjectsSerializer(serializers.Serializer):
    """Input serializer for the ``generate_subjects`` action."""

    email_body = serializers.CharField()

    class Meta:
        fields = ["email_body"]


__all__ = [
    "AIWriterDraftSerializer",
    "GenerateEmailSerializer",
    "GenerateSubjectsSerializer",
    "GenerateSummarySerializer",
]
