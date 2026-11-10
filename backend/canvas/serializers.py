"""DRF serializers for the canvas app."""

from __future__ import annotations

from rest_framework import serializers

from .models import CanvasTheme


class CanvasThemeSerializer(serializers.ModelSerializer):
    """Serializer for :class:`CanvasTheme`.

    ``tenant`` is omitted from the writable surface — the viewset
    injects it from ``request.tenant`` (singleton per org).
    """

    class Meta:
        model = CanvasTheme
        fields = [
            "id",
            "primary_color",
            "accent_color",
            "font_family",
            "border_radius",
            "density",
            "sidebar_style",
            "logo_url",
            "custom_css",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


__all__ = ["CanvasThemeSerializer"]
