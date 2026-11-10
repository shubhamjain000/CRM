"""django-filter FilterSets for the email_integration app."""

from __future__ import annotations

import django_filters

from .models import Email, EmailAccount, EmailThread, MailMergeCampaign


class EmailAccountFilter(django_filters.FilterSet):
    """Filter email accounts by provider / user / active state."""

    provider = django_filters.CharFilter(field_name="provider")
    user = django_filters.NumberFilter(field_name="user_id")
    is_active = django_filters.BooleanFilter(field_name="is_active")
    sync_enabled = django_filters.BooleanFilter(field_name="sync_enabled")

    class Meta:
        model = EmailAccount
        fields: list[str] = []


class EmailThreadFilter(django_filters.FilterSet):
    """Filter threads by related record / activity window."""

    related_module = django_filters.CharFilter(field_name="related_module")
    related_id = django_filters.CharFilter(field_name="related_id")
    last_activity_at__gte = django_filters.DateTimeFilter(
        field_name="last_activity_at", lookup_expr="gte"
    )
    last_activity_at__lte = django_filters.DateTimeFilter(
        field_name="last_activity_at", lookup_expr="lte"
    )

    class Meta:
        model = EmailThread
        fields: list[str] = []


class EmailFilter(django_filters.FilterSet):
    """Filter emails by account / thread / status / direction / record."""

    account = django_filters.NumberFilter(field_name="account_id")
    thread = django_filters.NumberFilter(field_name="thread_id")
    status = django_filters.CharFilter(field_name="status")
    direction = django_filters.CharFilter(field_name="direction")
    from_address = django_filters.CharFilter(field_name="from_address", lookup_expr="iexact")
    related_module = django_filters.CharFilter(field_name="related_module")
    related_id = django_filters.CharFilter(field_name="related_id")
    is_starred = django_filters.BooleanFilter(field_name="is_starred")
    is_important = django_filters.BooleanFilter(field_name="is_important")
    received_at__gte = django_filters.DateTimeFilter(
        field_name="received_at", lookup_expr="gte"
    )
    received_at__lte = django_filters.DateTimeFilter(
        field_name="received_at", lookup_expr="lte"
    )
    has_attachments = django_filters.BooleanFilter(field_name="has_attachments")

    class Meta:
        model = Email
        fields: list[str] = []


class MailMergeCampaignFilter(django_filters.FilterSet):
    """Filter mail-merge campaigns by status / creator."""

    status = django_filters.CharFilter(field_name="status")
    created_by = django_filters.NumberFilter(field_name="created_by_id")

    class Meta:
        model = MailMergeCampaign
        fields: list[str] = []
