"""DRF serializers for the goals app."""

from __future__ import annotations

from rest_framework import serializers

from .models import Goal, GoalAchievement


class GoalSerializer(serializers.ModelSerializer):
    """Serializer for :class:`Goal`."""

    percentage = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()

    class Meta:
        model = Goal
        fields = [
            "id",
            "owner_type",
            "owner_id",
            "metric",
            "period_type",
            "period_start",
            "period_end",
            "target_amount",
            "actual_amount",
            "percentage",
            "status",
            "is_active",
            "parent_goal",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "actual_amount", "percentage", "status", "created_at", "updated_at"]

    def _pct(self, obj: Goal) -> float:  # type: ignore[no-untyped-def]
        target = obj.target_amount or 0
        actual = obj.actual_amount or 0
        if target <= 0:
            return 100.0 if actual > 0 else 0.0
        return round(float(actual / target * 100), 2)

    def get_percentage(self, obj: Goal) -> float:  # type: ignore[no-untyped-def]
        return self._pct(obj)

    def get_status(self, obj: Goal) -> str:  # type: ignore[no-untyped-def]
        pct = self._pct(obj)
        if pct >= 100:
            return "exceeded"
        if pct >= 50:
            return "on_track"
        return "behind"


class GoalAchievementSerializer(serializers.ModelSerializer):
    """Serializer for :class:`GoalAchievement`."""

    user_email = serializers.CharField(source="user.email", read_only=True, default="")

    class Meta:
        model = GoalAchievement
        fields = [
            "id",
            "user",
            "user_email",
            "badge_type",
            "awarded_at",
            "created_at",
        ]
        read_only_fields = ["id", "user", "user_email", "awarded_at", "created_at"]


__all__ = ["GoalAchievementSerializer", "GoalSerializer"]
