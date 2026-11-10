"""DRF serializers for the accounts app."""

from __future__ import annotations

from rest_framework import serializers

from accounts.models import Account
from api.crm_base import CustomFieldsSerializerMixin, DynamicFieldsMixin
from api.crm_validators import validate_address, validate_url


class AccountSerializer(DynamicFieldsMixin, CustomFieldsSerializerMixin, serializers.ModelSerializer):
    """Serializer for :class:`accounts.models.Account`.

    Custom fields are exposed as a nested ``custom_fields`` dict keyed by the
    custom field's ``api_name``. ``tenant`` is auto-set from the request and
    never exposed.
    """

    custom_fields = serializers.DictField(child=serializers.JSONField(), required=False, allow_null=True)
    custom_field_module = "account"

    class Meta:
        model = Account
        fields = [
            "id",
            "name",
            "account_number",
            "account_type",
            "industry",
            "annual_revenue",
            "employees",
            "website",
            "billing_address",
            "shipping_address",
            "parent_account",
            "ticker_symbol",
            "ownership",
            "rating",
            "sic_code",
            "description",
            "tags",
            "owner",
            "last_activity",
            "created_at",
            "updated_at",
            "deleted_at",
            "custom_fields",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "deleted_at", "last_activity"]

    # ------------------------------------------------------------------ validation

    def validate_website(self, value: str) -> str:
        return validate_url(value, field_name="website")

    def validate_billing_address(self, value: dict) -> dict:
        return validate_address(value, field_name="billing_address")

    def validate_shipping_address(self, value: dict) -> dict:
        return validate_address(value, field_name="shipping_address")

    def validate_tags(self, value: list) -> list:
        if value is None:
            return []
        if not isinstance(value, list):
            raise serializers.ValidationError({"tags": "Must be a list of strings."})
        return [str(v) for v in value]

    # ------------------------------------------------------------------ create/update

    def create(self, validated_data: dict) -> Account:
        # ``tenant`` is auto-injected by the viewset's perform_create.
        request = self.context.get("request")
        if request is not None and "owner" not in validated_data:
            validated_data["owner"] = request.user
        return super().create(validated_data)


class AccountMergeSerializer(serializers.Serializer):
    """Payload for the ``merge`` action on the accounts viewset."""

    source_id = serializers.IntegerField()
    target_id = serializers.IntegerField()
