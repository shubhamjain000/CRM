"""django-filter FilterSets for the contacts app."""

from __future__ import annotations

import django_filters

from contacts.models import Contact


class ContactFilter(django_filters.FilterSet):
    """Filter contacts by key fields plus date-range and custom-field filters."""

    first_name = django_filters.CharFilter(lookup_expr="icontains")
    last_name = django_filters.CharFilter(lookup_expr="icontains")
    email = django_filters.CharFilter(method="filter_email", help_text="Sub-string match against the emails list.")
    account = django_filters.NumberFilter(field_name="account_id")
    account__isnull = django_filters.BooleanFilter(field_name="account_id", lookup_expr="isnull")
    owner = django_filters.NumberFilter(field_name="owner_id")
    owner_in = django_filters.BaseInFilter(field_name="owner_id", lookup_expr="in")
    lead_source = django_filters.CharFilter(lookup_expr="exact")
    do_not_call = django_filters.BooleanFilter()
    email_opt_out = django_filters.BooleanFilter()
    birthday__gte = django_filters.DateFilter(field_name="birthday", lookup_expr="gte")
    birthday__lte = django_filters.DateFilter(field_name="birthday", lookup_expr="lte")
    created_at__gte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")
    last_activity__gte = django_filters.DateTimeFilter(field_name="last_activity", lookup_expr="gte")
    last_activity__isnull = django_filters.BooleanFilter(field_name="last_activity", lookup_expr="isnull")
    custom_field = django_filters.CharFilter(method="filter_custom_field", help_text="api_name:value")

    class Meta:
        model = Contact
        fields: list[str] = []

    def filter_email(self, queryset, name, value):  # type: ignore[no-untyped-def]
        # JSON containment on the normalized dict form: [{"email": "...", "type": "..."}]
        return queryset.filter(emails__contains=[{"email": value}])

    def filter_custom_field(self, queryset, name, value):  # type: ignore[no-untyped-def]
        if ":" not in value:
            return queryset
        api_name, raw_value = value.split(":", 1)
        from custom_fields.models import CustomField, CustomFieldValue

        field_ids = CustomField.objects.filter(api_name=api_name, module="contact").values_list("id", flat=True)
        record_ids = CustomFieldValue.objects.filter(
            field_id__in=list(field_ids),
            module="contact",
            value__contains=raw_value,
        ).values_list("record_id", flat=True)
        return queryset.filter(pk__in=list(record_ids))
