"""DRF serializers for the tasks app."""

from __future__ import annotations

from rest_framework import serializers

from api.crm_base import DynamicFieldsMixin
from api.models import User
from tasks.models import Task


class ChecklistItemSerializer(serializers.Serializer):
    """A single ``{text, done}`` checklist item."""

    text = serializers.CharField(max_length=512)
    done = serializers.BooleanField(default=False)


class TaskSerializer(DynamicFieldsMixin, serializers.ModelSerializer):
    """Serializer for :class:`tasks.models.Task`."""

    checklist = serializers.ListField(
        child=ChecklistItemSerializer(),
        required=False,
        allow_empty=True,
    )
    tags = serializers.ListField(
        child=serializers.CharField(max_length=64),
        required=False,
        allow_empty=True,
    )

    class Meta:
        model = Task
        fields = [
            "id",
            "title",
            "description",
            "due_date",
            "reminder",
            "reminder_sent_at",
            "priority",
            "status",
            "assignee",
            "watchers",
            "related_module",
            "related_id",
            "recurrence",
            "parent_task",
            "time_spent",
            "timer_started_at",
            "checklist",
            "tags",
            "created_by",
            "owner",
            "last_activity",
            "completed_at",
            "created_at",
            "updated_at",
            "deleted_at",
        ]
        read_only_fields = [
            "id",
            "reminder_sent_at",
            "time_spent",
            "timer_started_at",
            "last_activity",
            "completed_at",
            "created_at",
            "updated_at",
            "deleted_at",
        ]

    # ------------------------------------------------------------------ create

    def create(self, validated_data: dict) -> Task:  # type: ignore[override]
        request = self.context.get("request")
        watchers = validated_data.pop("watchers", [])
        if request is not None:
            if "owner" not in validated_data:
                validated_data["owner"] = request.user
            if "created_by" not in validated_data:
                validated_data["created_by"] = request.user
            if "assignee" not in validated_data:
                validated_data["assignee"] = validated_data.get("owner") or request.user
        instance = super().create(validated_data)
        if watchers:
            instance.watchers.set(watchers)
        return instance

    def update(self, instance: Task, validated_data: dict) -> Task:  # type: ignore[override]
        watchers = validated_data.pop("watchers", None)
        updated = super().update(instance, validated_data)
        if watchers is not None:
            updated.watchers.set(watchers)
        return updated

    # ------------------------------------------------------------------ validation

    def validate_checklist(self, value: list[dict]) -> list[dict]:
        """Normalize checklist items to ``{text, done}`` dicts."""
        out: list[dict] = []
        for item in value or []:
            if not isinstance(item, dict):
                raise serializers.ValidationError(
                    "Each checklist item must be an object {text, done}."
                )
            text = (item.get("text") or "").strip()
            if not text:
                raise serializers.ValidationError("checklist item text cannot be empty.")
            out.append({"text": text, "done": bool(item.get("done", False))})
        return out

    def validate_tags(self, value: list[str]) -> list[str]:
        """Lowercase + de-duplicate tags."""
        seen: set[str] = set()
        out: list[str] = []
        for tag in value or []:
            tag = str(tag).strip().lower()
            if tag and tag not in seen:
                seen.add(tag)
                out.append(tag)
        return out

    def validate(self, attrs: dict) -> dict:  # type: ignore[override]
        due = attrs.get("due_date") or getattr(self.instance, "due_date", None)
        reminder = attrs.get("reminder") or getattr(self.instance, "reminder", None)
        if due and reminder and reminder > due:
            raise serializers.ValidationError(
                {"reminder": "Reminder must be earlier than due_date."}
            )
        return attrs


class TaskBulkUpdateSerializer(serializers.Serializer):
    """Payload for ``bulk_update``: ``{"ids": [...], "fields": {...}}``."""

    ids = serializers.ListField(
        child=serializers.IntegerField(),
        min_length=1,
        allow_empty=False,
    )
    fields = serializers.DictField()


class SubtaskCreateSerializer(serializers.Serializer):
    """Payload for ``add_subtask``."""

    title = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    due_date = serializers.DateTimeField(required=False, allow_null=True)
    priority = serializers.ChoiceField(choices=Task.PRIORITY_CHOICES, required=False)
    assignee = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.none(),
        required=False,
        allow_null=True,
    )

    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, **kwargs)
        # Late-bind the queryset so the serializer picks up the active tenant's
        # users when instantiated inside a request.
        self.fields["assignee"].queryset = User.objects.all()


class TimerActionSerializer(serializers.Serializer):
    """Marker serializer for ``start_timer`` / ``stop_timer`` (empty body OK)."""
