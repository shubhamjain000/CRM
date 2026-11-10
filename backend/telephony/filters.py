"""django-filter FilterSets for the telephony app."""

from __future__ import annotations

import django_filters

from .models import IvrFlow, PhoneNumber, SmsMessage, SmsTemplate, TelephonyCall


class PhoneNumberFilter(django_filters.FilterSet):
    """Filter phone numbers by provider / active / assignment."""

    provider = django_filters.CharFilter(field_name="provider")
    is_active = django_filters.BooleanFilter(field_name="is_active")
    assigned_to_type = django_filters.CharFilter(field_name="assigned_to_type")
    assigned_to_id = django_filters.CharFilter(field_name="assigned_to_id")

    class Meta:
        model = PhoneNumber
        fields: list[str] = []


class TelephonyCallFilter(django_filters.FilterSet):
    """Filter calls by direction / status / outcome / record / owner."""

    direction = django_filters.CharFilter(field_name="direction")
    status = django_filters.CharFilter(field_name="status")
    outcome = django_filters.CharFilter(field_name="outcome")
    sentiment = django_filters.CharFilter(field_name="sentiment")
    from_number = django_filters.CharFilter(field_name="from_number")
    to_number = django_filters.CharFilter(field_name="to_number")
    related_module = django_filters.CharFilter(field_name="related_module")
    related_id = django_filters.CharFilter(field_name="related_id")
    owner_id = django_filters.CharFilter(field_name="owner_id")
    started_at__gte = django_filters.DateTimeFilter(
        field_name="started_at", lookup_expr="gte"
    )
    started_at__lte = django_filters.DateTimeFilter(
        field_name="started_at", lookup_expr="lte"
    )

    class Meta:
        model = TelephonyCall
        fields: list[str] = []


class SmsTemplateFilter(django_filters.FilterSet):
    """Filter SMS templates by category / approval state."""

    category = django_filters.CharFilter(field_name="category")
    is_approved = django_filters.BooleanFilter(field_name="is_approved")

    class Meta:
        model = SmsTemplate
        fields: list[str] = []


class SmsMessageFilter(django_filters.FilterSet):
    """Filter SMS messages by direction / status / template / numbers."""

    direction = django_filters.CharFilter(field_name="direction")
    status = django_filters.CharFilter(field_name="status")
    template = django_filters.NumberFilter(field_name="template_id")
    from_number = django_filters.CharFilter(field_name="from_number")
    to_number = django_filters.CharFilter(field_name="to_number")
    related_module = django_filters.CharFilter(field_name="related_module")
    related_id = django_filters.CharFilter(field_name="related_id")
    sent_at__gte = django_filters.DateTimeFilter(field_name="sent_at", lookup_expr="gte")
    sent_at__lte = django_filters.DateTimeFilter(field_name="sent_at", lookup_expr="lte")

    class Meta:
        model = SmsMessage
        fields: list[str] = []


class IvrFlowFilter(django_filters.FilterSet):
    """Filter IVR flows by active state / phone number."""

    is_active = django_filters.BooleanFilter(field_name="is_active")
    phone_number = django_filters.NumberFilter(field_name="phone_number_id")

    class Meta:
        model = IvrFlow
        fields: list[str] = []
