"""DRF serializers for the template_builder app."""

from __future__ import annotations

from rest_framework import serializers

from .models import EmailTemplate, PdfTemplate


class EmailTemplateSerializer(serializers.ModelSerializer):
    """Serializer for :class:`EmailTemplate`."""

    class Meta:
        model = EmailTemplate
        fields = [
            "id",
            "name",
            "subject",
            "body_html",
            "category",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class PdfTemplateSerializer(serializers.ModelSerializer):
    """Serializer for :class:`PdfTemplate`."""

    class Meta:
        model = PdfTemplate
        fields = [
            "id",
            "name",
            "html_template",
            "css",
            "category",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


__all__ = ["EmailTemplateSerializer", "PdfTemplateSerializer"]
