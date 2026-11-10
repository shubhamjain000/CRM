"""DRF serializers for the profiles app."""

from __future__ import annotations

from rest_framework import serializers

from .models import FieldPermission, Profile, ProfilePermission


class ProfilePermissionSerializer(serializers.ModelSerializer):
    """Serializer for :class:`ProfilePermission`."""

    class Meta:
        model = ProfilePermission
        fields = [
            "id",
            "profile",
            "module",
            "can_view",
            "can_create",
            "can_edit",
            "can_delete",
            "can_export",
            "can_share",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class FieldPermissionSerializer(serializers.ModelSerializer):
    """Serializer for :class:`FieldPermission`."""

    class Meta:
        model = FieldPermission
        fields = [
            "id",
            "profile",
            "module",
            "field_name",
            "access",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class ProfileSerializer(serializers.ModelSerializer):
    """Serializer for :class:`Profile`.

    The detail endpoint nests the permission rows; the
    ``permission_matrix`` action returns the flattened matrix view.
    """

    permissions = ProfilePermissionSerializer(many=True, read_only=True)
    field_permissions = FieldPermissionSerializer(many=True, read_only=True)

    class Meta:
        model = Profile
        fields = [
            "id",
            "name",
            "description",
            "is_standard",
            "permissions",
            "field_permissions",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id", "is_standard", "permissions", "field_permissions",
            "created_at", "updated_at",
        ]


__all__ = [
    "FieldPermissionSerializer",
    "ProfilePermissionSerializer",
    "ProfileSerializer",
]
