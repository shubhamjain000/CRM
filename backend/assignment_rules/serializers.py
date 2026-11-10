"""DRF serializers for the assignment_rules app."""

from __future__ import annotations

from rest_framework import serializers

from assignment_rules.models import AssignmentHistory, AssignmentRule


class AssignmentRuleSerializer(serializers.ModelSerializer):
    """Serializer for :class:`assignment_rules.models.AssignmentRule`."""

    fallback_user_name = serializers.SerializerMethodField()

    class Meta:
        model = AssignmentRule
        fields = [
            "id",
            "target_model",
            "criteria",
            "strategy",
            "assign_to",
            "fallback_user",
            "fallback_user_name",
            "territory_field",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "fallback_user_name"]

    def get_fallback_user_name(self, obj: AssignmentRule) -> str:
        user = obj.fallback_user
        if user is None:
            return ""
        return getattr(user, "name", "") or getattr(user, "email", "")

    def validate_criteria(self, value: dict | None) -> dict:
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("criteria must be a JSON object.")
        return value

    def validate_assign_to(self, value: Any) -> Any:
        # ``assign_to`` shape depends on ``strategy`` — defer the strict
        # shape check to the service layer (the viewset only validates
        # that it's JSON-serializable).
        return value

    def validate(self, attrs: dict) -> dict:
        strategy = attrs.get("strategy") or getattr(self.instance, "strategy", None)
        territory_field = attrs.get("territory_field") or getattr(
            self.instance, "territory_field", ""
        )
        if strategy == "territory" and not territory_field:
            raise serializers.ValidationError(
                {"territory_field": "territory_field is required when strategy=territory."}
            )
        return attrs


class AssignmentHistorySerializer(serializers.ModelSerializer):
    """Read-only serializer for :class:`assignment_rules.models.AssignmentHistory`."""

    assigned_to_name = serializers.SerializerMethodField()
    rule_target_model = serializers.CharField(
        source="rule.target_model", read_only=True, default=""
    )
    rule_strategy = serializers.CharField(
        source="rule.strategy", read_only=True, default=""
    )

    class Meta:
        model = AssignmentHistory
        fields = [
            "id",
            "rule",
            "rule_target_model",
            "rule_strategy",
            "record_module",
            "record_id",
            "assigned_to",
            "assigned_to_name",
            "assigned_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_assigned_to_name(self, obj: AssignmentHistory) -> str:
        user = obj.assigned_to
        if user is None:
            return ""
        return getattr(user, "name", "") or getattr(user, "email", "")


__all__ = ["AssignmentHistorySerializer", "AssignmentRuleSerializer"]
