"""django-filter FilterSets for the whatsapp app."""

from __future__ import annotations

import django_filters

from .models import WhatsAppAccount, WhatsAppMessage, WhatsAppTemplate


class WhatsAppAccountFilter(django_filters.FilterSet):
    """Filter accounts by verified / active state."""

    is_verified = django_filters.BooleanFilter(field_name="is_verified")
    is_active = django_filters.BooleanFilter(field_name="is_active")

    class Meta:
        model = WhatsAppAccount
        fields: list[str] = []


class WhatsAppMessageFilter(django_filters.FilterSet):
    """Filter messages by direction / status / phone / record."""

    account = django_filters.NumberFilter(field_name="account_id")
    direction = django_filters.CharFilter(field_name="direction")
    status = django_filters.CharFilter(field_name="status")
    message_type = django_filters.CharFilter(field_name="message_type")
    from_phone = django_filters.CharFilter(field_name="from_phone")
    to_phone = django_filters.CharFilter(field_name="to_phone")
    related_module = django_filters.CharFilter(field_name="related_module")
    related_id = django_filters.CharFilter(field_name="related_id")
    timestamp__gte = django_filters.DateTimeFilter(field_name="timestamp", lookup_expr="gte")
    timestamp__lte = django_filters.DateTimeFilter(field_name="timestamp", lookup_expr="lte")

    class Meta:
        model = WhatsAppMessage
        fields: list[str] = []


class WhatsAppTemplateFilter(django_filters.FilterSet):
    """Filter templates by name / language / approval state."""

    name = django_filters.CharFilter(field_name="name", lookup_expr="icontains")
    language = django_filters.CharFilter(field_name="language")
    is_approved = django_filters.BooleanFilter(field_name="is_approved")

    class Meta:
        model = WhatsAppTemplate
        fields: list[str] = []
