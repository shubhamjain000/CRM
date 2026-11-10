"""DRF serializers for the events app."""

from __future__ import annotations

from rest_framework import serializers

from api.crm_base import DynamicFieldsMixin
from api.models import User
from events.models import Event, EventAttendee, Meeting


class ExternalAttendeeSerializer(serializers.Serializer):
    """A single external-attendee email entry."""

    email = serializers.EmailField()


class ReminderSpecSerializer(serializers.Serializer):
    """A single ``{offset_minutes, sent}`` reminder spec."""

    offset_minutes = serializers.IntegerField(min_value=0)
    sent = serializers.BooleanField(default=False, read_only=True)


class ActionItemSerializer(serializers.Serializer):
    """A single ``{text, done, assignee_id}`` meeting action item."""

    text = serializers.CharField(max_length=512)
    done = serializers.BooleanField(default=False)
    assignee_id = serializers.IntegerField(required=False, allow_null=True)


class EventAttendeeSerializer(serializers.ModelSerializer):
    """Serializer for the :class:`events.models.EventAttendee` through model."""

    email = serializers.SerializerMethodField()
    name = serializers.SerializerMethodField()

    class Meta:
        model = EventAttendee
        fields = [
            "id",
            "event",
            "user",
            "email",
            "name",
            "response",
            "required",
            "responded_at",
        ]
        read_only_fields = ["id", "event", "email", "name", "responded_at"]


class MeetingSerializer(serializers.ModelSerializer):
    """Serializer for the :class:`events.models.Meeting` profile."""

    action_items = serializers.ListField(
        child=ActionItemSerializer(),
        required=False,
        allow_empty=True,
    )

    class Meta:
        model = Meeting
        fields = [
            "event",
            "agenda",
            "action_items",
            "follow_up_tasks_created",
            "engagement_score",
        ]
        read_only_fields = ["event", "follow_up_tasks_created", "engagement_score"]


class EventSerializer(DynamicFieldsMixin, serializers.ModelSerializer):
    """Serializer for :class:`events.models.Event`."""

    attendee_ids = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(),
        many=True,
        required=False,
        write_only=True,
        help_text="Write-only list of user IDs to add as attendees (defaults required=True, response=none).",
    )
    attendees = serializers.SerializerMethodField()
    external_attendees = serializers.ListField(
        child=serializers.EmailField(),
        required=False,
        allow_empty=True,
    )
    reminders = serializers.ListField(
        child=ReminderSpecSerializer(),
        required=False,
        allow_empty=True,
    )
    meeting_profile = MeetingSerializer(read_only=True)

    class Meta:
        model = Event
        fields = [
            "id",
            "title",
            "description",
            "start",
            "end",
            "all_day",
            "location",
            "attendees",
            "attendee_ids",
            "external_attendees",
            "recurrence",
            "reminders",
            "conference_url",
            "conference_provider",
            "related_module",
            "related_id",
            "status",
            "organizer",
            "visibility",
            "last_expanded_at",
            "meeting_profile",
            "created_at",
            "updated_at",
            "deleted_at",
        ]
        read_only_fields = [
            "id",
            "attendees",
            "last_expanded_at",
            "meeting_profile",
            "created_at",
            "updated_at",
            "deleted_at",
        ]

    # ------------------------------------------------------------------ reads

    def get_attendees(self, obj: Event) -> list[dict]:
        """Return attendees as a list of {user, email, response, required} dicts."""
        out: list[dict] = []
        for link in obj.attendee_links.select_related("user").all():
            out.append(
                {
                    "user": link.user_id,
                    "email": link.user.email,
                    "response": link.response,
                    "required": link.required,
                    "responded_at": link.responded_at,
                }
            )
        return out

    # ------------------------------------------------------------------ create / update

    def create(self, validated_data: dict) -> Event:  # type: ignore[override]
        request = self.context.get("request")
        attendee_ids = validated_data.pop("attendee_ids", [])
        if request is not None and "organizer" not in validated_data:
            validated_data["organizer"] = request.user
        instance = super().create(validated_data)
        self._sync_attendees(instance, attendee_ids)
        return instance

    def update(self, instance: Event, validated_data: dict) -> Event:  # type: ignore[override]
        attendee_ids = validated_data.pop("attendee_ids", None)
        updated = super().update(instance, validated_data)
        if attendee_ids is not None:
            self._sync_attendees(updated, attendee_ids)
        return updated

    def _sync_attendees(self, event: Event, attendee_ids: list[User]) -> None:
        """Replace the event's attendee set with ``attendee_ids``."""
        existing = {link.user_id: link for link in event.attendee_links.all()}
        desired = {u.pk for u in attendee_ids}
        # Remove ones no longer desired.
        to_remove = [link for uid, link in existing.items() if uid not in desired]
        for link in to_remove:
            link.delete()
        # Add new ones; don't touch existing RSVPs.
        to_add = [uid for uid in desired if uid not in existing]
        for uid in to_add:
            EventAttendee.objects.create(event=event, user_id=uid, required=True)

    # ------------------------------------------------------------------ validation

    def validate(self, attrs: dict) -> dict:  # type: ignore[override]
        start = attrs.get("start") or getattr(self.instance, "start", None)
        end = attrs.get("end") or getattr(self.instance, "end", None)
        if start and end and end < start:
            raise serializers.ValidationError(
                {"end": "Event end must be at or after start."}
            )
        return attrs


class EventRespondSerializer(serializers.Serializer):
    """Payload for ``respond``: ``{"response": "yes|no|maybe"}."""

    response = serializers.ChoiceField(
        choices=[c[0] for c in EventAttendee.RESPONSE_CHOICES if c[0] != "none"]
    )


class ConflictCheckSerializer(serializers.Serializer):
    """Payload for ``detect_conflicts``: ``{"start": ..., "end": ..., "exclude_event_id": ...}``."""

    start = serializers.DateTimeField()
    end = serializers.DateTimeField()
    exclude_event_id = serializers.IntegerField(required=False, allow_null=True)

    def validate(self, attrs: dict) -> dict:  # type: ignore[override]
        if attrs["end"] < attrs["start"]:
            raise serializers.ValidationError({"end": "End must be at or after start."})
        return attrs
