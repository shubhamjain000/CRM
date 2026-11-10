"""django-filter FilterSets for the events app."""

from __future__ import annotations

import django_filters

from events.models import Event


class EventFilter(django_filters.FilterSet):
    """Filter events by date range / organizer / status / attendee."""

    start__gte = django_filters.DateTimeFilter(field_name="start", lookup_expr="gte")
    start__lte = django_filters.DateTimeFilter(field_name="start", lookup_expr="lte")
    end__gte = django_filters.DateTimeFilter(field_name="end", lookup_expr="gte")
    end__lte = django_filters.DateTimeFilter(field_name="end", lookup_expr="lte")
    organizer = django_filters.NumberFilter(field_name="organizer_id")
    organizer_in = django_filters.BaseInFilter(field_name="organizer_id", lookup_expr="in")
    status = django_filters.CharFilter(lookup_expr="exact")
    status_in = django_filters.BaseInFilter(field_name="status", lookup_expr="in")
    attendee = django_filters.NumberFilter(field_name="attendees", lookup_expr="exact")
    attendee_in = django_filters.BaseInFilter(field_name="attendees", lookup_expr="in")
    related_module = django_filters.CharFilter(lookup_expr="exact")
    related_id = django_filters.CharFilter(lookup_expr="exact")
    all_day = django_filters.BooleanFilter()
    has_recurrence = django_filters.BooleanFilter(method="filter_has_recurrence")
    title = django_filters.CharFilter(lookup_expr="icontains")

    class Meta:
        model = Event
        fields: list[str] = []

    def filter_has_recurrence(self, queryset, name, value):  # type: ignore[no-untyped-def]
        if value:
            return queryset.exclude(recurrence="")
        return queryset.filter(recurrence="")
