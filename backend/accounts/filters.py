"""django-filter FilterSets for the accounts app."""

from __future__ import annotations

import django_filters

from accounts.models import Account


class AccountFilter(django_filters.FilterSet):
    """Filter accounts by key fields plus date-range and custom-field filters."""

    name = django_filters.CharFilter(lookup_expr="icontains")
    account_type = django_filters.CharFilter(lookup_expr="exact")
    industry = django_filters.CharFilter(lookup_expr="icontains")
    rating = django_filters.CharFilter(lookup_expr="exact")
    owner = django_filters.NumberFilter(field_name="owner_id")
    owner_in = django_filters.BaseInFilter(field_name="owner_id", lookup_expr="in")
    parent_account = django_filters.NumberFilter(field_name="parent_account_id")
    parent_account__isnull = django_filters.BooleanFilter(field_name="parent_account_id", lookup_expr="isnull")
    employees__gt = django_filters.NumberFilter(field_name="employees", lookup_expr="gt")
    employees__lt = django_filters.NumberFilter(field_name="employees", lookup_expr="lt")
    annual_revenue__gt = django_filters.NumberFilter(field_name="annual_revenue", lookup_expr="gt")
    annual_revenue__lt = django_filters.NumberFilter(field_name="annual_revenue", lookup_expr="lt")
    created_at__gte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")
    last_activity__gte = django_filters.DateTimeFilter(field_name="last_activity", lookup_expr="gte")
    last_activity__isnull = django_filters.BooleanFilter(field_name="last_activity", lookup_expr="isnull")
    tags__contains = django_filters.CharFilter(method="filter_tags_contains")
    custom_field = django_filters.CharFilter(method="filter_custom_field", help_text="api_name:value")

    class Meta:
        model = Account
        fields: list[str] = []

    def filter_tags_contains(self, queryset, name, value):  # type: ignore[no-untyped-def]
        return queryset.filter(tags__contains=[value])

    def filter_custom_field(self, queryset, name, value):  # type: ignore[no-untyped-def]
        """Filter by a custom field value: ``?custom_field=industry_segment:enterprise``."""
        if ":" not in value:
            return queryset
        api_name, raw_value = value.split(":", 1)
        from custom_fields.models import CustomField, CustomFieldValue

        tenant_id = getattr(queryset.model, "_meta", None)
        # Filter via a subquery on CustomFieldValue joined to CustomField by api_name.
        # We can't easily parameterise the tenant here because the queryset is
        # already tenant-scoped by the manager; just match by api_name + value.
        field_ids = CustomField.objects.filter(api_name=api_name, module="account").values_list("id", flat=True)
        record_ids = CustomFieldValue.objects.filter(
            field_id__in=list(field_ids),
            module="account",
            value__contains=raw_value,
        ).values_list("record_id", flat=True)
        return queryset.filter(pk__in=list(record_ids))
