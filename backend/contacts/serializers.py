"""DRF serializers for the contacts app."""

from __future__ import annotations

from rest_framework import serializers

from api.crm_base import CustomFieldsSerializerMixin, DynamicFieldsMixin
from api.crm_validators import (
    validate_address,
    validate_emails,
    validate_phones,
    validate_url,
)
from contacts.models import Contact


class ContactSerializer(DynamicFieldsMixin, CustomFieldsSerializerMixin, serializers.ModelSerializer):
    """Serializer for :class:`contacts.models.Contact`."""

    custom_fields = serializers.DictField(child=serializers.JSONField(), required=False, allow_null=True)
    custom_field_module = "contact"
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = Contact
        fields = [
            "id",
            "first_name",
            "last_name",
            "account",
            "title",
            "emails",
            "phones",
            "addresses",
            "social_profiles",
            "birthday",
            "department",
            "assistant",
            "lead_source",
            "owner",
            "do_not_call",
            "email_opt_out",
            "description",
            "last_activity",
            "created_at",
            "updated_at",
            "deleted_at",
            "full_name",
            "custom_fields",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "deleted_at", "last_activity", "full_name"]

    def get_full_name(self, obj: Contact) -> str:
        return obj.full_name

    # ------------------------------------------------------------------ validation

    def validate_emails(self, value: list) -> list:
        return validate_emails(value)

    def validate_phones(self, value: list) -> list:
        return validate_phones(value)

    def validate_addresses(self, value: list) -> list:
        if value is None:
            return []
        if not isinstance(value, list):
            raise serializers.ValidationError({"addresses": "Must be a list."})
        out = []
        for item in value:
            out.append(validate_address(item, field_name="addresses"))
        return out

    def validate_social_profiles(self, value: dict) -> dict:
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError({"social_profiles": "Must be an object."})
        for key, val in value.items():
            if not isinstance(val, str):
                raise serializers.ValidationError(
                    {"social_profiles": f"Value for {key} must be a string."}
                )
            # Profile URLs may be empty.
            if val:
                try:
                    validate_url(val, field_name=f"social_profiles.{key}")
                except Exception:
                    raise serializers.ValidationError(
                        {"social_profiles": f"Invalid URL for {key}: {val}"}
                    )
        return value

    # ------------------------------------------------------------------ create

    def create(self, validated_data: dict) -> Contact:
        request = self.context.get("request")
        if request is not None and "owner" not in validated_data:
            validated_data["owner"] = request.user
        return super().create(validated_data)
