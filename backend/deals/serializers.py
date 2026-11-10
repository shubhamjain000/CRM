"""DRF serializers for the deals app."""

from __future__ import annotations

from rest_framework import serializers

from approvals.models import ApprovalProcess
from api.crm_base import CustomFieldsSerializerMixin, DynamicFieldsMixin
from deals.models import Deal, DealContact, DealStageHistory, StageTransition
from deals.models_pipeline import Pipeline, Stage


class StageSerializer(serializers.ModelSerializer):
    """Serializer for :class:`deals.models_pipeline.Stage`."""

    class Meta:
        model = Stage
        fields = [
            "id",
            "pipeline",
            "name",
            "probability",
            "order",
            "is_won_stage",
            "is_lost_stage",
            "is_closed",
            # ----- Phase 8 additions -----
            "forecast_category",
            "is_locked",
            "business_days_limit",
            "color",
            "icon",
        ]
        read_only_fields = ["id", "is_closed"]


class PipelineSerializer(serializers.ModelSerializer):
    """Serializer for :class:`deals.models_pipeline.Pipeline` with nested stages."""

    stages = StageSerializer(many=True, read_only=True)

    class Meta:
        model = Pipeline
        fields = ["id", "name", "is_default", "description", "stages"]
        read_only_fields = ["id", "stages"]


class DealContactSerializer(serializers.ModelSerializer):
    """Serializer for the ``DealContact`` through row."""

    contact_name = serializers.CharField(source="contact.full_name", read_only=True)

    class Meta:
        model = DealContact
        fields = ["id", "deal", "contact", "contact_name", "role", "created_at"]
        read_only_fields = ["id", "created_at", "contact_name"]


class DealSerializer(DynamicFieldsMixin, CustomFieldsSerializerMixin, serializers.ModelSerializer):
    """Serializer for :class:`deals.models.Deal`.

    Computed properties ``expected_revenue``, ``age``, ``is_won``, ``is_lost``,
    ``is_open`` are exposed read-only. ``probability`` defaults to the stage's
    probability when not provided on create.
    """

    custom_fields = serializers.DictField(child=serializers.JSONField(), required=False, allow_null=True)
    custom_field_module = "deal"
    expected_revenue = serializers.SerializerMethodField()
    age = serializers.IntegerField(read_only=True)
    is_won = serializers.BooleanField(read_only=True)
    is_lost = serializers.BooleanField(read_only=True)
    is_open = serializers.BooleanField(read_only=True)
    contact_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=None,  # set lazily in __init__ to avoid import cycles
        write_only=True,
        required=False,
    )

    class Meta:
        model = Deal
        fields = [
            "id",
            "name",
            "amount",
            "currency",
            "stage",
            "pipeline",
            "close_date",
            "probability",
            "forecast_category",
            "account",
            "primary_contact",
            "contact_ids",
            "owner",
            "lead_source",
            "type",
            "next_step",
            "description",
            "lost_reason",
            "competitors",
            "created_at",
            "updated_at",
            "deleted_at",
            "expected_revenue",
            "age",
            "is_won",
            "is_lost",
            "is_open",
            "custom_fields",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
            "deleted_at",
            "expected_revenue",
            "age",
            "is_won",
            "is_lost",
            "is_open",
            # forecast_category is derived from the stage and refreshed on
            # transition; callers may still set it explicitly for back-fills.
            "forecast_category",
        ]

    def __init__(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        super().__init__(*args, **kwargs)
        # Bind the contact_ids queryset lazily — avoids app-load-order issues.
        from contacts.models import Contact

        self.fields["contact_ids"].child_relation.queryset = Contact.objects.all()  # type: ignore[index]

    def get_expected_revenue(self, obj: Deal) -> str:
        """Return ``expected_revenue`` as a string to preserve Decimal precision."""
        return str(obj.expected_revenue)

    # ------------------------------------------------------------------ validation

    def validate_probability(self, value: float | None) -> float:
        if value is None:
            return 0.0
        if value < 0 or value > 100:
            raise serializers.ValidationError("probability must be between 0 and 100.")
        return float(value)

    def validate_competitors(self, value: list) -> list:
        if value is None:
            return []
        if not isinstance(value, list):
            raise serializers.ValidationError({"competitors": "Must be a list."})
        return [str(v) for v in value]

    def validate(self, attrs: dict) -> dict:
        stage = attrs.get("stage") or getattr(self.instance, "stage", None)
        pipeline = attrs.get("pipeline") or getattr(self.instance, "pipeline", None)
        if stage and pipeline and stage.pipeline_id != pipeline.pk:
            raise serializers.ValidationError(
                {"stage": "Stage must belong to the selected pipeline."}
            )
        return attrs

    # ------------------------------------------------------------------ create/update

    def create(self, validated_data: dict) -> Deal:
        contact_ids = validated_data.pop("contact_ids", None)
        request = self.context.get("request")
        if request is not None and "owner" not in validated_data:
            validated_data["owner"] = request.user
        # Default probability from the stage when not provided.
        if "probability" not in validated_data and validated_data.get("stage"):
            validated_data["probability"] = validated_data["stage"].probability
        # Default forecast_category from the stage when not provided.
        if "forecast_category" not in validated_data and validated_data.get("stage"):
            validated_data["forecast_category"] = validated_data["stage"].forecast_category
        deal = super().create(validated_data)
        if contact_ids:
            for contact in contact_ids:
                DealContact.objects.get_or_create(deal=deal, contact=contact)
        return deal

    def update(self, instance: Deal, validated_data: dict) -> Deal:  # type: ignore[override]
        contact_ids = validated_data.pop("contact_ids", None)
        deal = super().update(instance, validated_data)  # type: ignore[misc]
        if contact_ids is not None:
            existing = {dc.contact_id: dc for dc in deal.contact_links.all()}
            new_ids = {c.pk for c in contact_ids}
            # Remove contacts no longer in the list.
            for cid, dc in existing.items():
                if cid not in new_ids:
                    dc.delete()
            # Add new ones.
            for contact in contact_ids:
                if contact.pk not in existing:
                    DealContact.objects.create(deal=deal, contact=contact)
        return deal


###############################################################################
# Phase 8 — pipeline engine serializers
###############################################################################


class ApprovalProcessSerializer(serializers.ModelSerializer):
    """Minimal serializer for the :class:`approvals.models.ApprovalProcess`.

    Phase 10 promoted the Phase-8 stub to the ``approvals`` app and
    extended the schema. The full serializer lives in
    :mod:`approvals.serializers` — this thin shim is kept so existing
    integrations that ``from deals.serializers import
    ApprovalProcessSerializer`` keep working. New code should import
    from :mod:`approvals.serializers` directly.
    """

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
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class StageTransitionSerializer(serializers.ModelSerializer):
    """Serializer for :class:`deals.models.StageTransition`."""

    from_stage_name = serializers.CharField(source="from_stage.name", read_only=True)
    to_stage_name = serializers.CharField(source="to_stage.name", read_only=True)
    pipeline_name = serializers.CharField(source="pipeline.name", read_only=True)
    require_approval_name = serializers.CharField(
        source="require_approval.name", read_only=True, default=""
    )

    class Meta:
        model = StageTransition
        fields = [
            "id",
            "pipeline",
            "pipeline_name",
            "from_stage",
            "from_stage_name",
            "to_stage",
            "to_stage_name",
            "allowed_roles",
            "conditions",
            "require_approval",
            "require_approval_name",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]

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
        allowed_keys = {
            "min_amount",
            "max_amount",
            "min_probability",
            "max_probability",
            "require_account",
            "require_close_date",
        }
        unknown = set(value.keys()) - allowed_keys
        if unknown:
            raise serializers.ValidationError(
                f"Unknown condition keys: {sorted(unknown)}. Allowed: {sorted(allowed_keys)}."
            )
        return value

    def validate(self, attrs: dict) -> dict:
        from_stage = attrs.get("from_stage") or getattr(self.instance, "from_stage", None)
        to_stage = attrs.get("to_stage") or getattr(self.instance, "to_stage", None)
        pipeline = attrs.get("pipeline") or getattr(self.instance, "pipeline", None)
        if from_stage and to_stage and from_stage.pk == to_stage.pk:
            raise serializers.ValidationError(
                {"to_stage": "from_stage and to_stage must differ."}
            )
        if pipeline and from_stage and from_stage.pipeline_id != pipeline.pk:
            raise serializers.ValidationError(
                {"from_stage": "from_stage must belong to the pipeline."}
            )
        if pipeline and to_stage and to_stage.pipeline_id != pipeline.pk:
            raise serializers.ValidationError(
                {"to_stage": "to_stage must belong to the pipeline."}
            )
        return attrs


class DealStageHistorySerializer(serializers.ModelSerializer):
    """Serializer for :class:`deals.models.DealStageHistory`."""

    from_stage_name = serializers.CharField(source="from_stage.name", read_only=True, default="")
    to_stage_name = serializers.CharField(source="to_stage.name", read_only=True, default="")
    changed_by_name = serializers.SerializerMethodField()
    deal_name = serializers.CharField(source="deal.name", read_only=True)

    class Meta:
        model = DealStageHistory
        fields = [
            "id",
            "deal",
            "deal_name",
            "from_stage",
            "from_stage_name",
            "to_stage",
            "to_stage_name",
            "changed_by",
            "changed_by_name",
            "changed_at",
            "reason",
            "duration_in_previous_stage",
        ]
        read_only_fields = fields

    def get_changed_by_name(self, obj: DealStageHistory) -> str:
        user = obj.changed_by
        if user is None:
            return ""
        return getattr(user, "name", "") or getattr(user, "email", "")
