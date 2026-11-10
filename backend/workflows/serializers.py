"""DRF serializers for the workflows app."""

from __future__ import annotations

from rest_framework import serializers

from workflows.models import WorkflowAction, WorkflowExecution, WorkflowRule


class WorkflowActionSerializer(serializers.ModelSerializer):
    """Serializer for :class:`WorkflowAction` (nested under a rule)."""

    class Meta:
        model = WorkflowAction
        fields = [
            "id",
            "rule",
            "order",
            "action_type",
            "config",
            "created_at",
        ]
        read_only_fields = ["id", "rule", "created_at"]


class WorkflowRuleSerializer(serializers.ModelSerializer):
    """Serializer for :class:`WorkflowRule`.

    Accepts a nested list of ``actions`` on create / update so the whole
    rule can be authored in one payload. The viewset's ``create`` /
    ``update`` wire the nested writes.
    """

    actions = WorkflowActionSerializer(many=True, required=False)
    created_by_name = serializers.CharField(
        source="created_by.email", read_only=True, default=""
    )

    class Meta:
        model = WorkflowRule
        fields = [
            "id",
            "name",
            "trigger_type",
            "trigger_model",
            "trigger_conditions",
            "is_active",
            "version",
            "created_by",
            "created_by_name",
            "last_run_at",
            "run_count",
            "error_count",
            "actions",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "created_by",
            "created_by_name",
            "last_run_at",
            "run_count",
            "error_count",
            "created_at",
            "updated_at",
        ]

    def validate_trigger_conditions(self, value: dict | None) -> dict:
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("trigger_conditions must be a JSON object.")
        return value

    def create(self, validated_data: dict) -> WorkflowRule:  # type: ignore[override]
        actions_data = validated_data.pop("actions", [])
        rule = WorkflowRule.objects.create(**validated_data)
        self._sync_actions(rule, actions_data)
        return rule

    def update(self, instance: WorkflowRule, validated_data: dict) -> WorkflowRule:  # type: ignore[override]
        actions_data = validated_data.pop("actions", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if actions_data is not None:
            instance.actions.all().delete()
            self._sync_actions(instance, actions_data)
        return instance

    @staticmethod
    def _sync_actions(rule: WorkflowRule, actions_data: list[dict]) -> None:
        for index, item in enumerate(actions_data):
            WorkflowAction.objects.create(
                tenant=rule.tenant,
                rule=rule,
                order=item.get("order", index),
                action_type=item["action_type"],
                config=item.get("config", {}) or {},
            )


class WorkflowExecutionSerializer(serializers.ModelSerializer):
    """Read-only serializer for :class:`WorkflowExecution`."""

    rule_name = serializers.CharField(source="rule.name", read_only=True, default="")

    class Meta:
        model = WorkflowExecution
        fields = [
            "id",
            "rule",
            "rule_name",
            "target_module",
            "target_id",
            "status",
            "started_at",
            "completed_at",
            "error_message",
            "actions_executed",
            "created_at",
        ]
        read_only_fields = fields


__all__ = ["WorkflowActionSerializer", "WorkflowExecutionSerializer", "WorkflowRuleSerializer"]
