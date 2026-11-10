"""DRF serializers for the custom_fields app."""

from __future__ import annotations

from rest_framework import serializers

from custom_fields.models import CustomField, CustomFieldValue
from custom_fields.registry import REGISTRY, build_serializer_field


class CustomFieldSerializer(serializers.ModelSerializer):
    """Serializer for :class:`custom_fields.models.CustomField`."""

    field_type = serializers.ChoiceField(choices=[(k, v) for k, v in REGISTRY.items()])

    class Meta:
        model = CustomField
        fields = [
            "id",
            "tenant",
            "module",
            "label",
            "api_name",
            "field_type",
            "field_options",
            "validation_rules",
            "default_value",
            "is_required",
            "is_unique",
            "is_searchable",
            "description",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "tenant", "created_at", "updated_at"]

    def validate_api_name(self, value: str) -> str:
        from django.core.exceptions import ValidationError

        from custom_fields.models import _API_NAME_VALIDATOR

        try:
            _API_NAME_VALIDATOR(value)
        except ValidationError as exc:
            raise serializers.ValidationError(exc.message)
        return value

    def validate(self, attrs: dict) -> dict:
        # Run the model's ``clean()`` to surface picklist/lookup option checks.
        instance = CustomField(**attrs)
        instance.tenant_id = self.context.get("tenant_id") or (
            self.instance.tenant_id if self.instance else None
        )
        try:
            instance.clean()
        except Exception as exc:
            raise serializers.ValidationError(exc.message_dict if hasattr(exc, "message_dict") else str(exc))
        return attrs

    def create(self, validated_data: dict) -> CustomField:
        tenant_id = self.context.get("tenant_id")
        if tenant_id is None:
            raise serializers.ValidationError("tenant_id context is required.")
        return CustomField.objects.create(tenant_id=tenant_id, **validated_data)


class CustomFieldValueSerializer(serializers.ModelSerializer):
    """Serializer for :class:`custom_fields.models.CustomFieldValue`."""

    class Meta:
        model = CustomFieldValue
        fields = ["id", "field", "module", "record_id", "value", "created_at", "updated_at"]
        read_only_fields = ["id", "tenant", "module", "created_at", "updated_at"]


class CustomFieldDefinitionSerializer(serializers.Serializer):
    """Read-only serializer used to surface the schema for a module to the UI.

    Combines a :class:`CustomField` definition with a pre-bound DRF field
    instance so the frontend can render the right input component.
    """

    id = serializers.IntegerField(read_only=True)
    label = serializers.CharField(read_only=True)
    api_name = serializers.CharField(read_only=True)
    field_type = serializers.CharField(read_only=True)
    field_options = serializers.JSONField(read_only=True)
    is_required = serializers.BooleanField(read_only=True)
    is_unique = serializers.BooleanField(read_only=True)
    is_searchable = serializers.BooleanField(read_only=True)
    default_value = serializers.CharField(read_only=True, allow_blank=True)
    serializer_field_class = serializers.SerializerMethodField()

    def get_serializer_field_class(self, obj: CustomField) -> str:
        return build_serializer_field(obj).__class__.__name__
