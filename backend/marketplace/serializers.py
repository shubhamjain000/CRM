"""DRF serializers for the marketplace app."""

from __future__ import annotations

from rest_framework import serializers

from .models import Extension, InstalledExtension


class ExtensionSerializer(serializers.ModelSerializer):
    """Serializer for :class:`Extension`."""

    class Meta:
        model = Extension
        fields = [
            "id",
            "name",
            "developer",
            "version",
            "description",
            "category",
            "pricing",
            "is_verified",
            "is_featured",
            "downloads",
            "rating",
            "install_url",
            "permissions",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class InstalledExtensionSerializer(serializers.ModelSerializer):
    """Serializer for :class:`InstalledExtension`."""

    extension_name = serializers.CharField(source="extension.name", read_only=True)

    class Meta:
        model = InstalledExtension
        fields = [
            "id",
            "extension",
            "extension_name",
            "config",
            "status",
            "installed_at",
            "last_synced_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "installed_at", "created_at", "updated_at"]


__all__ = ["ExtensionSerializer", "InstalledExtensionSerializer"]
