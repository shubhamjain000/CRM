"""django-filter FilterSets for the leads app."""

from __future__ import annotations

import django_filters

from leads.models import Lead


class LeadFilter(django_filters.FilterSet):
    """Filter leads by key fields plus date-range and custom-field filters."""

    first_name = django_filters.CharFilter(lookup_expr="icontains")
    last_name = django_filters.CharFilter(lookup_expr="icontains")
    company = django_filters.CharFilter(lookup_expr="icontains")
    email = django_filters.CharFilter(method="filter_email")
    lead_source = django_filters.CharFilter(lookup_expr="exact")
    lead_status = django_filters.CharFilter(lookup_expr="exact")
    lead_status_in = django_filters.BaseInFilter(field_name="lead_status", lookup_expr="in")
    rating = django_filters.CharFilter(lookup_expr="exact")
    industry = django_filters.CharFilter(lookup_expr="icontains")
    owner = django_filters.NumberFilter(field_name="owner_id")
    owner_in = django_filters.BaseInFilter(field_name="owner_id", lookup_expr="in")
    assigned_to = django_filters.NumberFilter(field_name="assigned_to_id")
    assigned_to__isnull = django_filters.BooleanFilter(field_name="assigned_to_id", lookup_expr="isnull")
    is_converted = django_filters.BooleanFilter()
    score__gt = django_filters.NumberFilter(field_name="score", lookup_expr="gt")
    score__lt = django_filters.NumberFilter(field_name="score", lookup_expr="lt")
    annual_revenue__gt = django_filters.NumberFilter(field_name="annual_revenue", lookup_expr="gt")
    annual_revenue__lt = django_filters.NumberFilter(field_name="annual_revenue", lookup_expr="lt")
    employees__gt = django_filters.NumberFilter(field_name="employees", lookup_expr="gt")
    employees__lt = django_filters.NumberFilter(field_name="employees", lookup_expr="lt")
    last_activity__gte = django_filters.DateTimeFilter(field_name="last_activity", lookup_expr="gte")
    last_activity__isnull = django_filters.BooleanFilter(field_name="last_activity", lookup_expr="isnull")
    created_at__gte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")
    custom_field = django_filters.CharFilter(method="filter_custom_field", help_text="api_name:value")

    class Meta:
        model = Lead
        fields: list[str] = []

    def filter_email(self, queryset, name, value):  # type: ignore[no-untyped-def]
        return queryset.filter(emails__contains=[{"email": value}])

    def filter_custom_field(self, queryset, name, value):  # type: ignore[no-untyped-def]
        if ":" not in value:
            return queryset
        api_name, raw_value = value.split(":", 1)
        from custom_fields.models import CustomField, CustomFieldValue

        field_ids = CustomField.objects.filter(api_name=api_name, module="lead").values_list("id", flat=True)
        record_ids = CustomFieldValue.objects.filter(
            field_id__in=list(field_ids),
            module="lead",
            value__contains=raw_value,
        ).values_list("record_id", flat=True)
        return queryset.filter(pk__in=list(record_ids))
