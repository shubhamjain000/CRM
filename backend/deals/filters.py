"""django-filter FilterSets for the deals app."""

from __future__ import annotations

import django_filters

from deals.models import Deal


class DealFilter(django_filters.FilterSet):
    """Filter deals by key fields plus date-range and custom-field filters."""

    name = django_filters.CharFilter(lookup_expr="icontains")
    stage = django_filters.NumberFilter(field_name="stage_id")
    stage_in = django_filters.BaseInFilter(field_name="stage_id", lookup_expr="in")
    pipeline = django_filters.NumberFilter(field_name="pipeline_id")
    owner = django_filters.NumberFilter(field_name="owner_id")
    owner_in = django_filters.BaseInFilter(field_name="owner_id", lookup_expr="in")
    account = django_filters.NumberFilter(field_name="account_id")
    account__isnull = django_filters.BooleanFilter(field_name="account_id", lookup_expr="isnull")
    primary_contact = django_filters.NumberFilter(field_name="primary_contact_id")
    type = django_filters.CharFilter(lookup_expr="exact")
    lead_source = django_filters.CharFilter(lookup_expr="exact")
    amount__gt = django_filters.NumberFilter(field_name="amount", lookup_expr="gt")
    amount__lt = django_filters.NumberFilter(field_name="amount", lookup_expr="lt")
    probability__gt = django_filters.NumberFilter(field_name="probability", lookup_expr="gt")
    probability__lt = django_filters.NumberFilter(field_name="probability", lookup_expr="lt")
    close_date__gte = django_filters.DateFilter(field_name="close_date", lookup_expr="gte")
    close_date__lte = django_filters.DateFilter(field_name="close_date", lookup_expr="lte")
    close_date__isnull = django_filters.BooleanFilter(field_name="close_date", lookup_expr="isnull")
    created_at__gte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")
    is_won = django_filters.BooleanFilter(method="filter_is_won")
    is_lost = django_filters.BooleanFilter(method="filter_is_lost")
    is_open = django_filters.BooleanFilter(method="filter_is_open")
    custom_field = django_filters.CharFilter(method="filter_custom_field", help_text="api_name:value")

    class Meta:
        model = Deal
        fields: list[str] = []

    def filter_is_won(self, queryset, name, value):  # type: ignore[no-untyped-def]
        from deals.models_pipeline import Stage

        won_stage_ids = Stage.objects.filter(is_won_stage=True).values_list("id", flat=True)
        if value:
            return queryset.filter(stage_id__in=list(won_stage_ids))
        return queryset.exclude(stage_id__in=list(won_stage_ids))

    def filter_is_lost(self, queryset, name, value):  # type: ignore[no-untyped-def]
        from deals.models_pipeline import Stage

        lost_stage_ids = Stage.objects.filter(is_lost_stage=True).values_list("id", flat=True)
        if value:
            return queryset.filter(stage_id__in=list(lost_stage_ids))
        return queryset.exclude(stage_id__in=list(lost_stage_ids))

    def filter_is_open(self, queryset, name, value):  # type: ignore[no-untyped-def]
        from deals.models_pipeline import Stage

        closed_ids = list(
            Stage.objects.filter(is_won_stage=True).values_list("id", flat=True)
        ) + list(
            Stage.objects.filter(is_lost_stage=True).values_list("id", flat=True)
        )
        if value:
            return queryset.exclude(stage_id__in=closed_ids)
        return queryset.filter(stage_id__in=closed_ids)

    def filter_custom_field(self, queryset, name, value):  # type: ignore[no-untyped-def]
        if ":" not in value:
            return queryset
        api_name, raw_value = value.split(":", 1)
        from custom_fields.models import CustomField, CustomFieldValue

        field_ids = CustomField.objects.filter(api_name=api_name, module="deal").values_list("id", flat=True)
        record_ids = CustomFieldValue.objects.filter(
            field_id__in=list(field_ids),
            module="deal",
            value__contains=raw_value,
        ).values_list("record_id", flat=True)
        return queryset.filter(pk__in=list(record_ids))
