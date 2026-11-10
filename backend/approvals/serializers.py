"""DRF serializers for the approvals app."""

from __future__ import annotations

from rest_framework import serializers

from approvals.models import (
    ApprovalAction,
    ApprovalDelegation,
    ApprovalProcess,
    ApprovalRequest,
    ApprovalStep,
)


###############################################################################
# ApprovalStep
###############################################################################


class ApprovalStepSerializer(serializers.ModelSerializer):
    """Serializer for :class:`approvals.models.ApprovalStep`."""

    class Meta:
        model = ApprovalStep
        fields = [
            "id",
            "process",
            "order",
            "step_type",
            "approvers",
            "time_limit_hours",
            "escalation_approver",
            "require_comment",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_approvers(self, value: list | None) -> list:
        if value is None:
            return []
        if not isinstance(value, list):
            raise serializers.ValidationError("approvers must be a list of {type, value} dicts.")
        for entry in value:
            if not isinstance(entry, dict):
                raise serializers.ValidationError("Each approver entry must be an object.")
            if "type" not in entry or "value" not in entry:
                raise serializers.ValidationError(
                    "Each approver entry must have 'type' and 'value' keys."
                )
            if entry["type"] not in ("role", "user", "team", "dynamic"):
                raise serializers.ValidationError(
                    "approver type must be one of role / user / team / dynamic."
                )
        return value

    def validate_escalation_approver(self, value: dict | None) -> dict:
        if value in (None, ""):
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("escalation_approver must be a {type, value} object.")
        if "type" not in value or "value" not in value:
            raise serializers.ValidationError(
                "escalation_approver must have 'type' and 'value' keys."
            )
        return value


###############################################################################
# ApprovalProcess
###############################################################################


class ApprovalProcessSerializer(serializers.ModelSerializer):
    """Serializer for :class:`approvals.models.ApprovalProcess`.

    Read paths include the nested :class:`ApprovalStep` rows so the frontend
    can render the full process graph in one fetch. Writes go through the
    simple flat fields — callers create / reorder steps via the nested
    ``steps`` action on :class:`approvals.viewsets.ApprovalProcessViewSet`.
    """

    steps = ApprovalStepSerializer(many=True, read_only=True)
    step_count = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalProcess
        fields = [
            "id",
            "name",
            "description",
            "target_model",
            "trigger_criteria",
            "is_active",
            "version",
            "steps",
            "step_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "steps", "step_count"]

    def get_step_count(self, obj: ApprovalProcess) -> int:
        return obj.steps.count()

    def validate_trigger_criteria(self, value: dict | None) -> dict:
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("trigger_criteria must be a JSON object.")
        supported = {"$gt", "$lt", "$gte", "$lte", "$eq", "$ne", "$in", "$exists"}
        for field_name, ops in value.items():
            if not isinstance(ops, dict):
                raise serializers.ValidationError(
                    f"trigger_criteria['{field_name}'] must be an object of operator → operand."
                )
            unknown = set(ops.keys()) - supported
            if unknown:
                raise serializers.ValidationError(
                    f"trigger_criteria['{field_name}'] has unknown operators: {sorted(unknown)}. "
                    f"Supported: {sorted(supported)}."
                )
        return value


###############################################################################
# ApprovalRequest
###############################################################################


class ApprovalRequestSerializer(serializers.ModelSerializer):
    """Serializer for :class:`approvals.models.ApprovalRequest`.

    The runtime fields (``status``, ``current_step``, ``completed_at``) are
    read-only — callers mutate them via the ``approve`` / ``reject`` /
    ``delegate`` / ``recall`` actions on
    :class:`approvals.viewsets.ApprovalRequestViewSet`.
    """

    process_name = serializers.CharField(source="process.name", read_only=True)
    submitted_by_name = serializers.SerializerMethodField()
    current_step_order = serializers.IntegerField(
        source="current_step.order", read_only=True, default=None
    )
    current_step_type = serializers.CharField(
        source="current_step.step_type", read_only=True, default=""
    )
    target_label = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalRequest
        fields = [
            "id",
            "process",
            "process_name",
            "target_module",
            "target_id",
            "target_name",
            "target_label",
            "submitted_by",
            "submitted_by_name",
            "submitted_at",
            "current_step",
            "current_step_order",
            "current_step_type",
            "status",
            "completed_at",
            "comments",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
            "submitted_at",
            "submitted_by_name",
            "process_name",
            "current_step_order",
            "current_step_type",
            "target_label",
        ]

    def get_submitted_by_name(self, obj: ApprovalRequest) -> str:
        user = obj.submitted_by
        if user is None:
            return ""
        return getattr(user, "name", "") or getattr(user, "email", "")

    def get_target_label(self, obj: ApprovalRequest) -> str:
        return obj.target_name or f"{obj.target_module}:{obj.target_id}"


###############################################################################
# ApprovalAction
###############################################################################


class ApprovalActionSerializer(serializers.ModelSerializer):
    """Read-only serializer for :class:`approvals.models.ApprovalAction`."""

    approver_name = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalAction
        fields = [
            "id",
            "request",
            "approver",
            "approver_name",
            "action",
            "comment",
            "timestamp",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_approver_name(self, obj: ApprovalAction) -> str:
        user = obj.approver
        if user is None:
            return "system"
        return getattr(user, "name", "") or getattr(user, "email", "")


###############################################################################
# ApprovalDelegation
###############################################################################


class ApprovalDelegationSerializer(serializers.ModelSerializer):
    """Serializer for :class:`approvals.models.ApprovalDelegation`."""

    user_name = serializers.SerializerMethodField()
    delegate_to_name = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalDelegation
        fields = [
            "id",
            "user",
            "user_name",
            "delegate_to",
            "delegate_to_name",
            "start_date",
            "end_date",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "user_name", "delegate_to_name"]

    def get_user_name(self, obj: ApprovalDelegation) -> str:
        return getattr(obj.user, "name", "") or getattr(obj.user, "email", "")

    def get_delegate_to_name(self, obj: ApprovalDelegation) -> str:
        return getattr(obj.delegate_to, "name", "") or getattr(obj.delegate_to, "email", "")

    def validate(self, attrs: dict) -> dict:
        start = attrs.get("start_date") or getattr(self.instance, "start_date", None)
        end = attrs.get("end_date") or getattr(self.instance, "end_date", None)
        if start and end and start > end:
            raise serializers.ValidationError(
                {"end_date": "end_date must be on or after start_date."}
            )
        return attrs


__all__ = [
    "ApprovalActionSerializer",
    "ApprovalDelegationSerializer",
    "ApprovalProcessSerializer",
    "ApprovalRequestSerializer",
    "ApprovalStepSerializer",
]
