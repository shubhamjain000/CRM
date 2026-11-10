"""DRF serializers for the territories app."""

from __future__ import annotations

from rest_framework import serializers

from .models import Territory, TerritoryMember


class TerritoryMemberSerializer(serializers.ModelSerializer):
    """Serializer for :class:`TerritoryMember`."""

    user_email = serializers.CharField(source="user.email", read_only=True, default="")
    territory_name = serializers.CharField(
        source="territory.name", read_only=True, default=""
    )

    class Meta:
        model = TerritoryMember
        fields = [
            "id",
            "territory",
            "territory_name",
            "user",
            "user_email",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "user_email", "territory_name", "created_at", "updated_at"]


class TerritorySerializer(serializers.ModelSerializer):
    """Serializer for :class:`Territory`.

    The detail endpoint nests the members; the ``members`` action
    supports add / remove via POST.
    """

    members = TerritoryMemberSerializer(many=True, read_only=True)
    manager_email = serializers.CharField(
        source="manager.email", read_only=True, default=""
    )

    class Meta:
        model = Territory
        fields = [
            "id",
            "name",
            "rules",
            "manager",
            "manager_email",
            "parent",
            "is_active",
            "members",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "manager_email", "members", "created_at", "updated_at"]


__all__ = ["TerritoryMemberSerializer", "TerritorySerializer"]
