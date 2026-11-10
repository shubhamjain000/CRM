"""DRF serializers for the escalation_rules app."""

from __future__ import annotations

from rest_framework import serializers

from escalation_rules.models import EscalationLog, EscalationRule


class EscalationRuleSerializer(serializers.ModelSerializer):
    """Serializer for :class:`escalation_rules.models.EscalationRule`."""

    class Meta:
        model = EscalationRule
        fields = [
            "id",
            "target_model",
            "criteria",
            "time_limit_hours",
            "escalate_to",
            "action",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_criteria(self, value: dict | None) -> dict:
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("criteria must be a JSON object.")
        return value

    def validate_escalate_to(self, value: dict | None) -> dict:
        if value in (None, ""):
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("escalate_to must be a {type, value} object.")
        if "type" not in value or "value" not in value:
            raise serializers.ValidationError(
                "escalate_to must have 'type' and 'value' keys."
            )
        if value["type"] not in ("user", "role", "team"):
            raise serializers.ValidationError(
                "escalate_to.type must be one of user / role / team."
            )
        return value

    def validate_time_limit_hours(self, value: int | None) -> int:
        if value is None or value <= 0:
            raise serializers.ValidationError("time_limit_hours must be a positive integer.")
        return value


class EscalationLogSerializer(serializers.ModelSerializer):
    """Read-only serializer for :class:`escalation_rules.models.EscalationLog`."""

    escalated_to_name = serializers.SerializerMethodField()
    rule_target_model = serializers.CharField(
        source="rule.target_model", read_only=True, default=""
    )
    rule_time_limit_hours = serializers.IntegerField(
        source="rule.time_limit_hours", read_only=True, default=None
    )

    class Meta:
        model = EscalationLog
        fields = [
            "id",
            "rule",
            "rule_target_model",
            "rule_time_limit_hours",
            "record_module",
            "record_id",
            "escalated_to",
            "escalated_to_name",
            "action_taken",
            "created_at",
        ]
        read_only_fields = fields

    def get_escalated_to_name(self, obj: EscalationLog) -> str:
        user = obj.escalated_to
        if user is None:
            return ""
        return getattr(user, "name", "") or getattr(user, "email", "")


__all__ = ["EscalationLogSerializer", "EscalationRuleSerializer"]
