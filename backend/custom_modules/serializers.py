"""DRF serializers for the custom_modules app."""

from __future__ import annotations

from rest_framework import serializers

from .models import CustomModule, CustomModuleField, CustomModuleRecord


class CustomModuleFieldSerializer(serializers.ModelSerializer):
    """Serializer for :class:`CustomModuleField`."""

    class Meta:
        model = CustomModuleField
        fields = [
            "id",
            "module",
            "label",
            "api_name",
            "field_type",
            "field_options",
            "default_value",
            "is_required",
            "is_unique",
            "is_searchable",
            "display_order",
            "section",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class CustomModuleSerializer(serializers.ModelSerializer):
    """Serializer for :class:`CustomModule`.

    The detail endpoint nests the field schema via
    :class:`CustomModuleFieldSerializer`. The record count is exposed
    as ``record_count`` for list-view previews.
    """

    fields = CustomModuleFieldSerializer(many=True, read_only=True)
    record_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = CustomModule
        fields = [
            "id",
            "name",
            "plural_name",
            "slug",
            "icon",
            "color",
            "record_name_field",
            "is_active",
            "is_system",
            "fields",
            "record_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "is_system", "fields", "record_count", "created_at", "updated_at"]


class CustomModuleRecordSerializer(serializers.ModelSerializer):
    """Serializer for :class:`CustomModuleRecord`.

    ``record_name`` is computed from ``data[module.record_name_field]``.
    """

    record_name = serializers.SerializerMethodField()

    class Meta:
        model = CustomModuleRecord
        fields = [
            "id",
            "module",
            "data",
            "record_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "record_name", "created_at", "updated_at"]

    def get_record_name(self, obj: CustomModuleRecord) -> str:  # type: ignore[no-untyped-def]
        if not isinstance(obj.data, dict):
            return ""
        return str(obj.data.get(obj.module.record_name_field, "") or "")


__all__ = [
    "CustomModuleFieldSerializer",
    "CustomModuleRecordSerializer",
    "CustomModuleSerializer",
]
