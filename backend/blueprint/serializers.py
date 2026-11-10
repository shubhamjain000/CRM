"""DRF serializers for the blueprint app.

The :class:`BlueprintSerializer` nests its :class:`BlueprintState` rows
(and each state's :class:`BlueprintTimer` rows) so the frontend can render
the entire state graph in one fetch. The :class:`BlueprintTransitionSerializer`
nests :class:`BlueprintFieldRequirement` + :class:`BlueprintAssignment` for
the same reason.

The :class:`BlueprintExecutionSerializer` is read-only — executions are
created by the signal (:func:`blueprint.signals.deal_post_save_enforce`)
and advanced by the service (:meth:`blueprint.services.BlueprintService.execute_transition`).
The viewset exposes ``available_transitions`` / ``execute_transition`` /
``compliance_report`` / ``stuck_deals`` actions for the runtime moves.
"""

from __future__ import annotations

from rest_framework import serializers

from blueprint.models import (
    Blueprint,
    BlueprintAssignment,
    BlueprintExecution,
    BlueprintFieldRequirement,
    BlueprintState,
    BlueprintTimer,
    BlueprintTransition,
)


###############################################################################
# Sub-serializers
###############################################################################


class BlueprintTimerSerializer(serializers.ModelSerializer):
    """Serializer for :class:`blueprint.models.BlueprintTimer`."""

    target_state_stage = serializers.CharField(
        source="target_state.stage.name", read_only=True, default=""
    )

    class Meta:
        model = BlueprintTimer
        fields = [
            "id",
            "state",
            "target_state",
            "target_state_stage",
            "hours",
            "action",
            "notify_roles",
            "escalate_to",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "target_state_stage"]


class BlueprintFieldRequirementSerializer(serializers.ModelSerializer):
    """Serializer for :class:`blueprint.models.BlueprintFieldRequirement`."""

    class Meta:
        model = BlueprintFieldRequirement
        fields = [
            "id",
            "transition",
            "field_name",
            "condition",
            "value",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class BlueprintAssignmentSerializer(serializers.ModelSerializer):
    """Serializer for :class:`blueprint.models.BlueprintAssignment`."""

    class Meta:
        model = BlueprintAssignment
        fields = [
            "id",
            "transition",
            "assign_to",
            "assign_value",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class BlueprintStateSerializer(serializers.ModelSerializer):
    """Serializer for :class:`blueprint.models.BlueprintState` with nested timers."""

    stage_name = serializers.CharField(source="stage.name", read_only=True)
    pipeline_name = serializers.CharField(source="stage.pipeline.name", read_only=True)
    timers = BlueprintTimerSerializer(many=True, read_only=True)

    class Meta:
        model = BlueprintState
        fields = [
            "id",
            "blueprint",
            "stage",
            "stage_name",
            "pipeline_name",
            "state_type",
            "entry_actions",
            "exit_actions",
            "time_limit_hours",
            "escalation_blueprint",
            "timers",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "stage_name", "pipeline_name", "timers"]


class BlueprintTransitionSerializer(serializers.ModelSerializer):
    """Serializer for :class:`blueprint.models.BlueprintTransition`.

    Nests the structured :class:`BlueprintFieldRequirement` +
    :class:`BlueprintAssignment` rows so the frontend can render the
    full transition rule set in a single fetch.
    """

    from_state_stage = serializers.CharField(source="from_state.stage.name", read_only=True)
    to_state_stage = serializers.CharField(source="to_state.stage.name", read_only=True)
    require_approval_name = serializers.CharField(
        source="require_approval.name", read_only=True, default=""
    )
    field_requirements = BlueprintFieldRequirementSerializer(many=True, read_only=True)
    assignments = BlueprintAssignmentSerializer(many=True, read_only=True)

    class Meta:
        model = BlueprintTransition
        fields = [
            "id",
            "blueprint",
            "from_state",
            "from_state_stage",
            "to_state",
            "to_state_stage",
            "allowed_roles",
            "conditions",
            "require_fields",
            "require_approval",
            "require_approval_name",
            "post_transition_actions",
            "field_requirements",
            "assignments",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
            "from_state_stage",
            "to_state_stage",
            "require_approval_name",
            "field_requirements",
            "assignments",
        ]

    # ------------------------------------------------------------------ validation

    def validate_allowed_roles(self, value: list | None) -> list:
        if value is None:
            return []
        if not isinstance(value, list):
            raise serializers.ValidationError("allowed_roles must be a list of role names.")
        return [str(v).lower() for v in value]

    def validate_conditions(self, value: dict | None) -> dict:
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("conditions must be a JSON object.")
        # Validate operator keys are from the supported set.
        supported = {"$gt", "$lt", "$gte", "$lte", "$eq", "$ne", "$in", "$exists"}
        for field_name, ops in value.items():
            if not isinstance(ops, dict):
                raise serializers.ValidationError(
                    f"conditions['{field_name}'] must be an object of operator → operand."
                )
            unknown = set(ops.keys()) - supported
            if unknown:
                raise serializers.ValidationError(
                    f"conditions['{field_name}'] has unknown operators: {sorted(unknown)}. "
                    f"Supported: {sorted(supported)}."
                )
        return value

    def validate(self, attrs: dict) -> dict:
        from_state = attrs.get("from_state") or getattr(self.instance, "from_state", None)
        to_state = attrs.get("to_state") or getattr(self.instance, "to_state", None)
        blueprint = attrs.get("blueprint") or getattr(self.instance, "blueprint", None)
        if from_state and to_state and from_state.pk == to_state.pk:
            raise serializers.ValidationError(
                {"to_state": "from_state and to_state must differ."}
            )
        if blueprint and from_state and from_state.blueprint_id != blueprint.pk:
            raise serializers.ValidationError(
                {"from_state": "from_state must belong to the blueprint."}
            )
        if blueprint and to_state and to_state.blueprint_id != blueprint.pk:
            raise serializers.ValidationError(
                {"to_state": "to_state must belong to the blueprint."}
            )
        return attrs


###############################################################################
# Top-level Blueprint serializer (nested states + transitions)
###############################################################################


class BlueprintSerializer(serializers.ModelSerializer):
    """Serializer for :class:`blueprint.models.Blueprint`.

    Read paths include the nested :class:`BlueprintState` +
    :class:`BlueprintTransition` rows so the frontend can render the full
    state graph in one fetch. Writes go through the simple flat fields —
    callers create states / transitions via their own endpoints.
    """

    pipeline_name = serializers.CharField(source="pipeline.name", read_only=True)
    states = BlueprintStateSerializer(many=True, read_only=True)
    transitions = BlueprintTransitionSerializer(many=True, read_only=True)
    state_count = serializers.SerializerMethodField()
    transition_count = serializers.SerializerMethodField()

    class Meta:
        model = Blueprint
        fields = [
            "id",
            "name",
            "pipeline",
            "pipeline_name",
            "is_active",
            "is_published",
            "description",
            "version",
            "states",
            "transitions",
            "state_count",
            "transition_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
            "pipeline_name",
            "states",
            "transitions",
            "state_count",
            "transition_count",
        ]

    def get_state_count(self, obj: Blueprint) -> int:
        return getattr(obj, "_state_count", None) or obj.states.count()

    def get_transition_count(self, obj: Blueprint) -> int:
        return getattr(obj, "_transition_count", None) or obj.transitions.count()


###############################################################################
# Execution
###############################################################################


class BlueprintExecutionSerializer(serializers.ModelSerializer):
    """Read-only serializer for :class:`blueprint.models.BlueprintExecution`.

    The ``current_state_stage`` + ``current_state_type`` fields are
    convenience annotations for the frontend. ``history`` is the raw JSON
    list of transition records.
    """

    deal_name = serializers.CharField(source="deal.name", read_only=True)
    blueprint_name = serializers.CharField(source="blueprint.name", read_only=True)
    current_state_stage = serializers.CharField(
        source="current_state.stage.name", read_only=True, default=""
    )
    current_state_type = serializers.CharField(
        source="current_state.state_type", read_only=True, default=""
    )
    hours_in_state = serializers.SerializerMethodField()

    class Meta:
        model = BlueprintExecution
        fields = [
            "id",
            "deal",
            "deal_name",
            "blueprint",
            "blueprint_name",
            "current_state",
            "current_state_stage",
            "current_state_type",
            "entered_state_at",
            "history",
            "is_complete",
            "hours_in_state",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_hours_in_state(self, obj: BlueprintExecution) -> float | None:
        if obj.entered_state_at is None:
            return None
        from django.utils import timezone

        delta = timezone.now() - obj.entered_state_at
        return round(delta.total_seconds() / 3600.0, 2)


__all__ = [
    "BlueprintAssignmentSerializer",
    "BlueprintExecutionSerializer",
    "BlueprintFieldRequirementSerializer",
    "BlueprintSerializer",
    "BlueprintStateSerializer",
    "BlueprintTimerSerializer",
    "BlueprintTransitionSerializer",
]
