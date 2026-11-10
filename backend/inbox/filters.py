"""django-filter FilterSets for the unified inbox app."""

from __future__ import annotations

import django_filters

from .models import InboxMacro, UnifiedConversation, UnifiedMessage


class UnifiedConversationFilter(django_filters.FilterSet):
    """Filter conversations by channel / status / assignee / etc."""

    channel = django_filters.CharFilter(field_name="channel")
    status = django_filters.CharFilter(field_name="status")
    priority = django_filters.CharFilter(field_name="priority")
    assigned_to = django_filters.NumberFilter(field_name="assigned_to_id")
    is_unassigned = django_filters.BooleanFilter(method="_filter_is_unassigned")
    participant_identifier = django_filters.CharFilter(field_name="participant_identifier")
    related_module = django_filters.CharFilter(field_name="related_module")
    related_id = django_filters.CharFilter(field_name="related_id")
    is_merged = django_filters.BooleanFilter(field_name="is_merged")
    last_message_at__gte = django_filters.DateTimeFilter(
        field_name="last_message_at", lookup_expr="gte"
    )
    last_message_at__lte = django_filters.DateTimeFilter(
        field_name="last_message_at", lookup_expr="lte"
    )

    class Meta:
        model = UnifiedConversation
        fields: list[str] = []

    def _filter_is_unassigned(self, queryset, name, value):  # type: ignore[no-untyped-def]
        if value:
            return queryset.filter(assigned_to__isnull=True)
        return queryset.filter(assigned_to__isnull=False)


class UnifiedMessageFilter(django_filters.FilterSet):
    """Filter messages by conversation / channel / sender / read state."""

    conversation = django_filters.NumberFilter(field_name="conversation_id")
    channel = django_filters.CharFilter(field_name="channel")
    sender = django_filters.CharFilter(field_name="sender")
    is_read = django_filters.BooleanFilter(field_name="is_read")
    timestamp__gte = django_filters.DateTimeFilter(field_name="timestamp", lookup_expr="gte")
    timestamp__lte = django_filters.DateTimeFilter(field_name="timestamp", lookup_expr="lte")

    class Meta:
        model = UnifiedMessage
        fields: list[str] = []


class InboxMacroFilter(django_filters.FilterSet):
    """Filter macros by name."""

    name = django_filters.CharFilter(field_name="name", lookup_expr="icontains")

    class Meta:
        model = InboxMacro
        fields: list[str] = []
