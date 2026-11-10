"""django-filter FilterSets for the attachments app."""

from __future__ import annotations

import django_filters

from attachments.models import Attachment


class AttachmentFilter(django_filters.FilterSet):
    """Filter attachments by record module + record id + file + inline flag."""

    record_module = django_filters.CharFilter(lookup_expr="exact")
    record_id = django_filters.CharFilter(lookup_expr="exact")
    file = django_filters.NumberFilter(field_name="file_id")
    attached_by = django_filters.NumberFilter(field_name="attached_by_id")
    is_inline = django_filters.BooleanFilter(field_name="is_inline")
    created_at__gte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")

    class Meta:
        model = Attachment
        fields: list[str] = []
