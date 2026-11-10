"""DRF serializers for the leads app."""

from __future__ import annotations

from rest_framework import serializers

from api.crm_base import CustomFieldsSerializerMixin, DynamicFieldsMixin
from api.crm_validators import (
    validate_address,
    validate_emails,
    validate_phones,
    validate_url,
)
from leads.models import Lead


class LeadSerializer(DynamicFieldsMixin, CustomFieldsSerializerMixin, serializers.ModelSerializer):
    """Serializer for :class:`leads.models.Lead`."""

    custom_fields = serializers.DictField(child=serializers.JSONField(), required=False, allow_null=True)
    custom_field_module = "lead"
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = Lead
        fields = [
            "id",
            "first_name",
            "last_name",
            "company",
            "title",
            "emails",
            "phones",
            "lead_source",
            "lead_status",
            "rating",
            "industry",
            "annual_revenue",
            "employees",
            "website",
            "billing_address",
            "shipping_address",
            "description",
            "owner",
            "assigned_to",
            "created_by",
            "last_activity",
            "score",
            "is_converted",
            "converted_account",
            "converted_contact",
            "converted_deal",
            "created_at",
            "updated_at",
            "deleted_at",
            "full_name",
            "custom_fields",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
            "deleted_at",
            "last_activity",
            "is_converted",
            "converted_account",
            "converted_contact",
            "converted_deal",
            "full_name",
        ]

    def get_full_name(self, obj: Lead) -> str:
        return obj.full_name

    # ------------------------------------------------------------------ validation

    def validate_emails(self, value: list) -> list:
        return validate_emails(value)

    def validate_phones(self, value: list) -> list:
        return validate_phones(value)

    def validate_billing_address(self, value: dict) -> dict:
        return validate_address(value, field_name="billing_address")

    def validate_shipping_address(self, value: dict) -> dict:
        return validate_address(value, field_name="shipping_address")

    def validate_website(self, value: str) -> str:
        return validate_url(value, field_name="website")

    def validate_score(self, value: float | None) -> float:
        if value is None:
            return 0.0
        if value < 0 or value > 100:
            raise serializers.ValidationError("score must be between 0 and 100.")
        return float(value)

    # ------------------------------------------------------------------ create

    def create(self, validated_data: dict) -> Lead:
        request = self.context.get("request")
        if request is not None:
            if "owner" not in validated_data:
                validated_data["owner"] = request.user
            if "created_by" not in validated_data:
                validated_data["created_by"] = request.user
        return super().create(validated_data)


class LeadConvertSerializer(serializers.Serializer):
    """Payload for the ``convert_lead`` action.

    All fields optional — sensible defaults are derived from the lead.
    """

    create_deal = serializers.BooleanField(default=True)
    deal_name = serializers.CharField(required=False, allow_blank=True)
    deal_amount = serializers.DecimalField(
        max_digits=18, decimal_places=2, required=False, allow_null=True
    )
    pipeline_id = serializers.IntegerField(required=False, allow_null=True)
    stage_id = serializers.IntegerField(required=False, allow_null=True)
    close_date = serializers.DateField(required=False, allow_null=True)
