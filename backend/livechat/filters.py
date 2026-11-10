"""django-filter FilterSets for the livechat app."""

from __future__ import annotations

import django_filters

from .models import ChatMessage, ChatSession, CannedResponse, ProactiveRule


class ChatSessionFilter(django_filters.FilterSet):
    """Filter sessions by status / assignee / visitor / record."""

    status = django_filters.CharFilter(field_name="status")
    assigned_to = django_filters.NumberFilter(field_name="assigned_to_id")
    visitor_email = django_filters.CharFilter(field_name="visitor_email")
    visitor_id = django_filters.CharFilter(field_name="visitor_id")
    related_module = django_filters.CharFilter(field_name="related_module")
    related_id = django_filters.CharFilter(field_name="related_id")
    started_at__gte = django_filters.DateTimeFilter(field_name="started_at", lookup_expr="gte")
    started_at__lte = django_filters.DateTimeFilter(field_name="started_at", lookup_expr="lte")

    class Meta:
        model = ChatSession
        fields: list[str] = []


class ChatMessageFilter(django_filters.FilterSet):
    """Filter messages by session / sender / read state."""

    session = django_filters.NumberFilter(field_name="session_id")
    sender = django_filters.CharFilter(field_name="sender")
    is_read = django_filters.BooleanFilter(field_name="is_read")
    timestamp__gte = django_filters.DateTimeFilter(field_name="timestamp", lookup_expr="gte")
    timestamp__lte = django_filters.DateTimeFilter(field_name="timestamp", lookup_expr="lte")

    class Meta:
        model = ChatMessage
        fields: list[str] = []


class CannedResponseFilter(django_filters.FilterSet):
    """Filter canned responses by category / key."""

    category = django_filters.CharFilter(field_name="category")
    key = django_filters.CharFilter(field_name="key", lookup_expr="icontains")

    class Meta:
        model = CannedResponse
        fields: list[str] = []


class ProactiveRuleFilter(django_filters.FilterSet):
    """Filter proactive rules by active state."""

    is_active = django_filters.BooleanFilter(field_name="is_active")

    class Meta:
        model = ProactiveRule
        fields: list[str] = []
