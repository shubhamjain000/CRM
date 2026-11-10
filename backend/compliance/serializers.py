"""DRF serializers for the compliance app."""

from __future__ import annotations

from rest_framework import serializers

from .models import ComplianceChecklist, ComplianceFramework, DataProcessingConsent


class ComplianceFrameworkSerializer(serializers.ModelSerializer):
    """Serializer for :class:`ComplianceFramework`."""

    class Meta:
        model = ComplianceFramework
        fields = [
            "id",
            "name",
            "description",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class ComplianceChecklistSerializer(serializers.ModelSerializer):
    """Serializer for :class:`ComplianceChecklist`."""

    class Meta:
        model = ComplianceChecklist
        fields = [
            "id",
            "framework",
            "item",
            "status",
            "evidence",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class DataProcessingConsentSerializer(serializers.ModelSerializer):
    """Serializer for :class:`DataProcessingConsent`."""

    class Meta:
        model = DataProcessingConsent
        fields = [
            "id",
            "user",
            "consent_type",
            "granted_at",
            "withdrawn_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "granted_at", "created_at", "updated_at"]


__all__ = [
    "ComplianceFrameworkSerializer",
    "ComplianceChecklistSerializer",
    "DataProcessingConsentSerializer",
]
