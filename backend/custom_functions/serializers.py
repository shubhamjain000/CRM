"""DRF serializers for the custom_functions app."""

from __future__ import annotations

from rest_framework import serializers

from .models import (
    CustomFunction,
    CustomFunctionExecution,
    CustomFunctionVariable,
    CustomFunctionVersion,
    HttpAllowlist,
    HttpCallLog,
    KVStore,
)


class CustomFunctionVariableSerializer(serializers.ModelSerializer):
    """Serializer for :class:`CustomFunctionVariable` (nested under a function)."""

    class Meta:
        model = CustomFunctionVariable
        fields = [
            "id",
            "function",
            "name",
            "var_type",
            "data_type",
            "description",
            "default_value",
            "is_required",
            "created_at",
        ]
        read_only_fields = ["id", "function", "created_at"]


class CustomFunctionSerializer(serializers.ModelSerializer):
    """Serializer for :class:`CustomFunction`.

    Accepts a nested list of ``variables`` on create / update so the whole
    function can be authored in one payload.
    """

    variables = CustomFunctionVariableSerializer(many=True, required=False)
    created_by_name = serializers.CharField(
        source="created_by.email", read_only=True, default=""
    )

    class Meta:
        model = CustomFunction
        fields = [
            "id",
            "name",
            "description",
            "language",
            "trigger_event",
            "code",
            "version",
            "is_active",
            "is_approved",
            "created_by",
            "created_by_name",
            "last_executed_at",
            "execution_count",
            "error_count",
            "variables",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "version",
            "created_by",
            "created_by_name",
            "last_executed_at",
            "execution_count",
            "error_count",
            "created_at",
            "updated_at",
        ]

    def validate_code(self, value: str | None) -> str:
        if value is None:
            return ""
        if not isinstance(value, str):
            raise serializers.ValidationError("code must be a string.")
        return value

    def create(self, validated_data: dict) -> CustomFunction:  # type: ignore[override]
        variables_data = validated_data.pop("variables", [])
        function = CustomFunction.objects.create(**validated_data)
        self._sync_variables(function, variables_data)
        return function

    def update(
        self, instance: CustomFunction, validated_data: dict
    ) -> CustomFunction:  # type: ignore[override]
        variables_data = validated_data.pop("variables", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if variables_data is not None:
            instance.variables.all().delete()
            self._sync_variables(instance, variables_data)
        return instance

    @staticmethod
    def _sync_variables(
        function: CustomFunction, variables_data: list[dict]
    ) -> None:
        for item in variables_data:
            CustomFunctionVariable.objects.create(
                tenant=function.tenant,
                function=function,
                name=item["name"],
                var_type=item.get("var_type", "input"),
                data_type=item.get("data_type", "string"),
                description=item.get("description", ""),
                default_value=item.get("default_value", ""),
                is_required=bool(item.get("is_required", False)),
            )


class CustomFunctionExecutionSerializer(serializers.ModelSerializer):
    """Read-only serializer for :class:`CustomFunctionExecution`."""

    function_name = serializers.CharField(
        source="function.name", read_only=True, default=""
    )

    class Meta:
        model = CustomFunctionExecution
        fields = [
            "id",
            "function",
            "function_name",
            "trigger",
            "input_data",
            "output_data",
            "status",
            "started_at",
            "completed_at",
            "error_message",
            "log_output",
            "execution_time_ms",
            "created_at",
        ]
        read_only_fields = fields


class CustomFunctionVersionSerializer(serializers.ModelSerializer):
    """Read-only serializer for :class:`CustomFunctionVersion`."""

    created_by_name = serializers.CharField(
        source="created_by.email", read_only=True, default=""
    )

    class Meta:
        model = CustomFunctionVersion
        fields = [
            "id",
            "function",
            "version",
            "code",
            "created_by",
            "created_by_name",
            "created_at",
        ]
        read_only_fields = fields


class HttpAllowlistSerializer(serializers.ModelSerializer):
    """Serializer for :class:`HttpAllowlist`."""

    class Meta:
        model = HttpAllowlist
        fields = [
            "id",
            "domain",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class HttpCallLogSerializer(serializers.ModelSerializer):
    """Read-only serializer for :class:`HttpCallLog`."""

    class Meta:
        model = HttpCallLog
        fields = [
            "id",
            "function_execution",
            "url",
            "method",
            "status_code",
            "request_body_size",
            "response_body_size",
            "created_at",
        ]
        read_only_fields = fields


class KVStoreSerializer(serializers.ModelSerializer):
    """Serializer for :class:`KVStore`."""

    class Meta:
        model = KVStore
        fields = ["id", "key", "value", "updated_at", "created_at"]
        read_only_fields = ["id", "updated_at", "created_at"]


__all__ = [
    "CustomFunctionExecutionSerializer",
    "CustomFunctionSerializer",
    "CustomFunctionVariableSerializer",
    "CustomFunctionVersionSerializer",
    "HttpAllowlistSerializer",
    "HttpCallLogSerializer",
    "KVStoreSerializer",
]
