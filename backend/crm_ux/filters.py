"""django-filter FilterSets for the crm_ux viewsets."""

from __future__ import annotations

import django_filters

from .models import (
    Activity,
    FileAttachment,
    Note,
    RecordLock,
    RecentlyViewed,
    SavedView,
)


class SavedViewFilter(django_filters.FilterSet):
    """Filter SavedView by module, sharing, ownership, default flag."""

    module = django_filters.CharFilter(field_name="module", lookup_expr="exact")
    is_shared = django_filters.BooleanFilter(field_name="is_shared")
    is_default = django_filters.BooleanFilter(field_name="is_default")
    user = django_filters.NumberFilter(field_name="user_id")
    name = django_filters.CharFilter(field_name="name", lookup_expr="icontains")
    created_at__gte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")

    class Meta:
        model = SavedView
        fields: list[str] = []


class RecentlyViewedFilter(django_filters.FilterSet):
    """Filter RecentlyViewed by module + viewed_at range."""

    module = django_filters.CharFilter(field_name="module", lookup_expr="exact")
    record_id = django_filters.CharFilter(field_name="record_id", lookup_expr="exact")
    viewed_at__gte = django_filters.DateTimeFilter(field_name="viewed_at", lookup_expr="gte")
    viewed_at__lte = django_filters.DateTimeFilter(field_name="viewed_at", lookup_expr="lte")

    class Meta:
        model = RecentlyViewed
        fields: list[str] = []


class ActivityFilter(django_filters.FilterSet):
    """Filter Activity by (module + record_id) or by user + action + date range."""

    module = django_filters.CharFilter(field_name="module", lookup_expr="exact")
    record_id = django_filters.CharFilter(field_name="record_id", lookup_expr="exact")
    user = django_filters.NumberFilter(field_name="user_id")
    action = django_filters.CharFilter(field_name="action", lookup_expr="exact")
    action_in = django_filters.BaseInFilter(field_name="action", lookup_expr="in")
    created_at__gte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")

    class Meta:
        model = Activity
        fields: list[str] = []


class NoteFilter(django_filters.FilterSet):
    """Filter Note by module + record_id + author + hashtag + date range."""

    module = django_filters.CharFilter(field_name="module", lookup_expr="exact")
    record_id = django_filters.CharFilter(field_name="record_id", lookup_expr="exact")
    user = django_filters.NumberFilter(field_name="user_id")
    hashtag = django_filters.CharFilter(method="filter_hashtag")
    created_at__gte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")

    class Meta:
        model = Note
        fields: list[str] = []

    def filter_hashtag(self, queryset, name, value):  # type: ignore[no-untyped-def]
        """JSON-array containment: ``hashtags`` contains ``value``."""
        return queryset.filter(hashtags__contains=[value.lower()])


class FileAttachmentFilter(django_filters.FilterSet):
    """Filter FileAttachment by module + record_id + mime type."""

    module = django_filters.CharFilter(field_name="module", lookup_expr="exact")
    record_id = django_filters.CharFilter(field_name="record_id", lookup_expr="exact")
    user = django_filters.NumberFilter(field_name="user_id")
    mime_type = django_filters.CharFilter(field_name="mime_type", lookup_expr="icontains")
    created_at__gte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")

    class Meta:
        model = FileAttachment
        fields: list[str] = []


class RecordLockFilter(django_filters.FilterSet):
    """Filter RecordLock by module + record_id + holder."""

    module = django_filters.CharFilter(field_name="module", lookup_expr="exact")
    record_id = django_filters.CharFilter(field_name="record_id", lookup_expr="exact")
    user = django_filters.NumberFilter(field_name="user_id")

    class Meta:
        model = RecordLock
        fields: list[str] = []
