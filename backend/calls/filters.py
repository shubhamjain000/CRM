"""django-filter FilterSets for the calls app."""

from __future__ import annotations

import django_filters

from calls.models import Call


class CallFilter(django_filters.FilterSet):
    """Filter calls by call_type / outcome / date range / related record."""

    call_type = django_filters.CharFilter(lookup_expr="exact")
    call_type_in = django_filters.BaseInFilter(field_name="call_type", lookup_expr="in")
    outcome = django_filters.CharFilter(lookup_expr="exact")
    outcome_in = django_filters.BaseInFilter(field_name="outcome", lookup_expr="in")
    sentiment = django_filters.CharFilter(lookup_expr="exact")
    related_module = django_filters.CharFilter(lookup_expr="exact")
    related_id = django_filters.CharFilter(lookup_expr="exact")
    attendee = django_filters.NumberFilter(field_name="attendees", lookup_expr="exact")
    created_by = django_filters.NumberFilter(field_name="created_by_id")
    voip_provider = django_filters.CharFilter(lookup_expr="exact")
    voip_call_id = django_filters.CharFilter(lookup_expr="iexact")
    started_at__gte = django_filters.DateTimeFilter(field_name="started_at", lookup_expr="gte")
    started_at__lte = django_filters.DateTimeFilter(field_name="started_at", lookup_expr="lte")
    ended_at__isnull = django_filters.BooleanFilter(field_name="ended_at", lookup_expr="isnull")
    duration__gte = django_filters.NumberFilter(field_name="duration", lookup_expr="gte")
    duration__lte = django_filters.NumberFilter(field_name="duration", lookup_expr="lte")
    subject = django_filters.CharFilter(lookup_expr="icontains")

    class Meta:
        model = Call
        fields: list[str] = []
