"""DRF serializers for the calls app."""

from __future__ import annotations

from rest_framework import serializers

from api.crm_base import DynamicFieldsMixin
from api.models import User
from calls.models import Call


class CallSerializer(DynamicFieldsMixin, serializers.ModelSerializer):
    """Serializer for :class:`calls.models.Call`."""

    attendee_ids = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(),
        many=True,
        required=False,
        write_only=True,
        help_text="Write-only list of internal attendee user IDs.",
    )
    attendees = serializers.SerializerMethodField()

    class Meta:
        model = Call
        fields = [
            "id",
            "subject",
            "call_type",
            "duration",
            "outcome",
            "recording_url",
            "transcription",
            "sentiment",
            "attendees",
            "attendee_ids",
            "related_module",
            "related_id",
            "voip_provider",
            "voip_call_id",
            "notes",
            "started_at",
            "ended_at",
            "created_by",
            "created_at",
            "updated_at",
            "deleted_at",
        ]
        read_only_fields = [
            "id",
            "attendees",
            "created_by",
            "created_at",
            "updated_at",
            "deleted_at",
        ]

    # ------------------------------------------------------------------ reads

    def get_attendees(self, obj: Call) -> list[dict]:
        """Return attendees as a list of {id, email} dicts."""
        return [
            {"id": u.pk, "email": u.email}
            for u in obj.attendees.all()
        ]

    # ------------------------------------------------------------------ create / update

    def create(self, validated_data: dict) -> Call:  # type: ignore[override]
        request = self.context.get("request")
        attendee_ids = validated_data.pop("attendee_ids", [])
        if request is not None and "created_by" not in validated_data:
            validated_data["created_by"] = request.user
        instance = super().create(validated_data)
        if attendee_ids:
            instance.attendees.set(attendee_ids)
        return instance

    def update(self, instance: Call, validated_data: dict) -> Call:  # type: ignore[override]
        attendee_ids = validated_data.pop("attendee_ids", None)
        updated = super().update(instance, validated_data)
        if attendee_ids is not None:
            updated.attendees.set(attendee_ids)
        return updated

    # ------------------------------------------------------------------ validation

    def validate(self, attrs: dict) -> dict:  # type: ignore[override]
        started = attrs.get("started_at") or getattr(self.instance, "started_at", None)
        ended = attrs.get("ended_at") or getattr(self.instance, "ended_at", None)
        if started and ended and ended < started:
            raise serializers.ValidationError(
                {"ended_at": "ended_at must be at or after started_at."}
            )
        # Missed calls should not have a duration > 0.
        call_type = attrs.get("call_type") or getattr(self.instance, "call_type", None)
        duration = attrs.get("duration", None)
        if duration is None:
            duration = getattr(self.instance, "duration", 0)
        if call_type == "missed" and (duration or 0) > 0:
            raise serializers.ValidationError(
                {"duration": "Missed calls must have a zero duration."}
            )
        return attrs


class LogCallSerializer(serializers.Serializer):
    """Payload for ``log_call`` — quick-create a call from a CRM record.

    All fields are optional except ``subject`` and ``started_at``. The
    ``related_module`` + ``related_id`` link the call to a CRM record so the
    signal handler writes a ``called`` activity on that record.
    """

    subject = serializers.CharField(max_length=255)
    call_type = serializers.ChoiceField(choices=Call.CALL_TYPE_CHOICES, default="outbound")
    duration = serializers.IntegerField(min_value=0, default=0)
    outcome = serializers.ChoiceField(choices=Call.OUTCOME_CHOICES, default="connected")
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    related_module = serializers.CharField(required=False, allow_blank=True, default="")
    related_id = serializers.CharField(required=False, allow_blank=True, default="")
    started_at = serializers.DateTimeField()
    ended_at = serializers.DateTimeField(required=False, allow_null=True)
    voip_provider = serializers.CharField(required=False, allow_blank=True, default="")
    voip_call_id = serializers.CharField(required=False, allow_blank=True, default="")
    attendee_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        allow_empty=True,
    )
