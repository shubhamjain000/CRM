"""django-filter FilterSets for the files app."""

from __future__ import annotations

import django_filters

from files.models import File


class FileFilter(django_filters.FilterSet):
    """Filter files by uploader / related module / tags / starred / scan status."""

    uploaded_by = django_filters.NumberFilter(field_name="uploaded_by_id")
    uploaded_by_in = django_filters.BaseInFilter(field_name="uploaded_by_id", lookup_expr="in")
    related_module = django_filters.CharFilter(lookup_expr="exact")
    related_id = django_filters.CharFilter(lookup_expr="exact")
    mime_type = django_filters.CharFilter(lookup_expr="exact")
    mime_type__startswith = django_filters.CharFilter(
        field_name="mime_type", lookup_expr="startswith"
    )
    extension = django_filters.CharFilter(lookup_expr="iexact")
    is_starred = django_filters.BooleanFilter(field_name="is_starred")
    virus_scan_status = django_filters.CharFilter(lookup_expr="exact")
    ocr_status = django_filters.CharFilter(lookup_expr="exact")
    storage_provider = django_filters.CharFilter(lookup_expr="exact")
    tag = django_filters.CharFilter(method="filter_tag", help_text="Exact (case-insensitive) tag match.")
    shared_with = django_filters.NumberFilter(
        field_name="shares__user_id", lookup_expr="exact", distinct=True
    )
    created_at__gte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")
    size__gte = django_filters.NumberFilter(field_name="size", lookup_expr="gte")
    size__lte = django_filters.NumberFilter(field_name="size", lookup_expr="lte")

    class Meta:
        model = File
        fields: list[str] = []

    def filter_tag(self, queryset, name, value):  # type: ignore[no-untyped-def]
        if not value:
            return queryset
        return queryset.filter(tags__contains=[value.lower()])
