"""django-filter FilterSets for the notes app."""

from __future__ import annotations

import django_filters

from notes.models import Note


class NoteFilter(django_filters.FilterSet):
    """Filter notes by author / related module / tags / pinned / private."""

    author = django_filters.NumberFilter(field_name="author_id")
    author_in = django_filters.BaseInFilter(field_name="author_id", lookup_expr="in")
    related_module = django_filters.CharFilter(lookup_expr="exact")
    related_id = django_filters.CharFilter(lookup_expr="exact")
    is_pinned = django_filters.BooleanFilter(field_name="is_pinned")
    is_private = django_filters.BooleanFilter(field_name="is_private")
    body_type = django_filters.CharFilter(lookup_expr="exact")
    tag = django_filters.CharFilter(method="filter_tag", help_text="Exact (case-insensitive) tag match.")
    hashtag = django_filters.CharFilter(method="filter_hashtag", help_text="Exact #hashtag match.")
    mention = django_filters.NumberFilter(method="filter_mention", help_text="User ID mentioned in the body.")
    shared_with = django_filters.NumberFilter(
        field_name="shares__user_id", lookup_expr="exact", distinct=True
    )
    created_at__gte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")

    class Meta:
        model = Note
        fields: list[str] = []

    # ------------------------------------------------------------------ methods

    def filter_tag(self, queryset, name, value):  # type: ignore[no-untyped-def]
        if not value:
            return queryset
        return queryset.filter(tags__contains=[value.lower()])

    def filter_hashtag(self, queryset, name, value):  # type: ignore[no-untyped-def]
        if not value:
            return queryset
        token = value.lstrip("#").lower()
        return queryset.filter(hashtags__contains=[token])

    def filter_mention(self, queryset, name, value):  # type: ignore[no-untyped-def]
        if not value:
            return queryset
        return queryset.filter(mentions__contains=[int(value)])
