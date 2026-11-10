"""DRF serializers for the layouts app."""

from __future__ import annotations

from rest_framework import serializers

from .models import Layout, LayoutSection


class LayoutSectionSerializer(serializers.ModelSerializer):
    """Serializer for :class:`LayoutSection`."""

    class Meta:
        model = LayoutSection
        fields = [
            "id",
            "layout",
            "name",
            "columns",
            "order",
            "is_collapsible",
            "fields",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class LayoutSerializer(serializers.ModelSerializer):
    """Serializer for :class:`Layout`.

    The detail endpoint nests the sections via
    :class:`LayoutSectionSerializer`.
    """

    sections = LayoutSectionSerializer(many=True, read_only=True)

    class Meta:
        model = Layout
        fields = [
            "id",
            "module",
            "profile",
            "name",
            "config",
            "is_default",
            "sections",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "sections", "created_at", "updated_at"]


__all__ = ["LayoutSerializer", "LayoutSectionSerializer"]
