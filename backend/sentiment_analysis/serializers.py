"""DRF serializers for the sentiment_analysis app."""

from __future__ import annotations

from rest_framework import serializers

from .models import Sentiment


class SentimentSerializer(serializers.ModelSerializer):
    """Serializer for :class:`Sentiment`."""

    class Meta:
        model = Sentiment
        fields = [
            "id",
            "record_module",
            "record_id",
            "sentiment",
            "confidence",
            "model_version",
            "analyzed_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "sentiment",
            "confidence",
            "model_version",
            "analyzed_at",
            "created_at",
            "updated_at",
        ]


__all__ = ["SentimentSerializer"]
