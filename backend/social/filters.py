"""django-filter FilterSets for the social app."""

from __future__ import annotations

import django_filters

from .models import ScheduledPost, SocialAccount, SocialMention


class SocialAccountFilter(django_filters.FilterSet):
    """Filter social accounts by provider / handle / active state."""

    provider = django_filters.CharFilter(field_name="provider")
    handle = django_filters.CharFilter(field_name="handle", lookup_expr="iexact")
    is_active = django_filters.BooleanFilter(field_name="is_active")

    class Meta:
        model = SocialAccount
        fields: list[str] = []


class SocialMentionFilter(django_filters.FilterSet):
    """Filter mentions by provider / sentiment / read / assignee / record."""

    account = django_filters.NumberFilter(field_name="account_id")
    provider = django_filters.CharFilter(field_name="provider")
    sentiment = django_filters.CharFilter(field_name="sentiment")
    is_read = django_filters.BooleanFilter(field_name="is_read")
    assigned_to = django_filters.NumberFilter(field_name="assigned_to_id")
    related_module = django_filters.CharFilter(field_name="related_module")
    related_id = django_filters.CharFilter(field_name="related_id")
    created_at__gte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")

    class Meta:
        model = SocialMention
        fields: list[str] = []


class ScheduledPostFilter(django_filters.FilterSet):
    """Filter scheduled posts by account / status / window."""

    account = django_filters.NumberFilter(field_name="account_id")
    status = django_filters.CharFilter(field_name="status")
    scheduled_at__gte = django_filters.DateTimeFilter(
        field_name="scheduled_at", lookup_expr="gte"
    )
    scheduled_at__lte = django_filters.DateTimeFilter(
        field_name="scheduled_at", lookup_expr="lte"
    )

    class Meta:
        model = ScheduledPost
        fields: list[str] = []
