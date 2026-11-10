"""DRF serializers for the validation_rules app."""

from __future__ import annotations

from rest_framework import serializers

from validation_rules.models import ValidationRule


class ValidationRuleSerializer(serializers.ModelSerializer):
    """Serializer for :class:`validation_rules.models.ValidationRule`."""

    class Meta:
        model = ValidationRule
        fields = [
            "id",
            "target_model",
            "field_name",
            "condition_type",
            "condition_value",
            "error_message",
            "error_severity",
            "trigger_on",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_condition_value(self, value: dict | None) -> dict:
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("condition_value must be a JSON object.")
        return value

    def validate(self, attrs: dict) -> dict:
        condition_type = attrs.get("condition_type") or getattr(
            self.instance, "condition_type", None
        )
        condition_value = attrs.get("condition_value") or getattr(
            self.instance, "condition_value", {}
        )
        if condition_type == "regex" and "regex" not in (condition_value or {}):
            raise serializers.ValidationError(
                {"condition_value": "regex condition requires a 'regex' key."}
            )
        if condition_type == "range":
            cv = condition_value or {}
            if "min" not in cv and "max" not in cv:
                raise serializers.ValidationError(
                    {"condition_value": "range condition requires at least one of 'min' / 'max'."}
                )
        if condition_type == "custom" and "expression" not in (condition_value or {}):
            raise serializers.ValidationError(
                {"condition_value": "custom condition requires an 'expression' key."}
            )
        return attrs


class ValidationViolationSerializer(serializers.Serializer):
    """Serializer for a single :class:`validation_rules.services.ValidationViolation`."""

    rule_id = serializers.IntegerField()
    target_model = serializers.CharField()
    field_name = serializers.CharField()
    condition_type = serializers.CharField()
    severity = serializers.CharField()
    message = serializers.CharField()


__all__ = ["ValidationRuleSerializer", "ValidationViolationSerializer"]
