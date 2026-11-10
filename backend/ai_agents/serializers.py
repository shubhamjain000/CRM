"""DRF serializers for the ai_agents app."""

from __future__ import annotations

from rest_framework import serializers

from .models import AIAgentRun


class AIAgentRunSerializer(serializers.ModelSerializer):
    """Serializer for :class:`AIAgentRun`."""

    class Meta:
        model = AIAgentRun
        fields = [
            "id",
            "agent_type",
            "target_module",
            "target_id",
            "status",
            "result",
            "started_at",
            "completed_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "status",
            "result",
            "started_at",
            "completed_at",
            "created_at",
            "updated_at",
        ]


class TriggerSerializer(serializers.Serializer):
    """Input serializer for the ``trigger`` action."""

    agent_type = serializers.CharField()
    target_module = serializers.CharField(required=False, default="")
    target_id = serializers.CharField(required=False, default="")

    class Meta:
        fields = ["agent_type", "target_module", "target_id"]


__all__ = ["AIAgentRunSerializer", "TriggerSerializer"]
