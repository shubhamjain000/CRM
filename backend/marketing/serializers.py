"""DRF serializers for the marketing app."""

from __future__ import annotations

from rest_framework import serializers

from .models import Campaign, MarketingEmail, SubscriberList


class CampaignSerializer(serializers.ModelSerializer):
    """Serializer for :class:`Campaign`."""

    class Meta:
        model = Campaign
        fields = [
            "id",
            "name",
            "type",
            "status",
            "start_date",
            "end_date",
            "metrics",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class SubscriberListSerializer(serializers.ModelSerializer):
    """Serializer for :class:`SubscriberList`."""

    class Meta:
        model = SubscriberList
        fields = [
            "id",
            "name",
            "subscriber_count",
            "subscribers",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class MarketingEmailSerializer(serializers.ModelSerializer):
    """Serializer for :class:`MarketingEmail`."""

    campaign_name = serializers.CharField(source="campaign.name", read_only=True, default="")

    class Meta:
        model = MarketingEmail
        fields = [
            "id",
            "campaign",
            "campaign_name",
            "subject",
            "body_html",
            "sent_count",
            "open_count",
            "click_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "sent_count",
            "open_count",
            "click_count",
            "created_at",
            "updated_at",
        ]


__all__ = ["CampaignSerializer", "MarketingEmailSerializer", "SubscriberListSerializer"]
