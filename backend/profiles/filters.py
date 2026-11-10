"""django-filter FilterSets for the profiles app."""

from __future__ import annotations

import django_filters

from .models import FieldPermission, Profile, ProfilePermission


class ProfileFilter(django_filters.FilterSet):
    """Filter profiles by name / standard."""

    name = django_filters.CharFilter(field_name="name", lookup_expr="icontains")
    is_standard = django_filters.BooleanFilter(field_name="is_standard")

    class Meta:
        model = Profile
        fields: list[str] = []


class ProfilePermissionFilter(django_filters.FilterSet):
    """Filter profile permissions by profile / module."""

    profile = django_filters.NumberFilter(field_name="profile_id")
    module = django_filters.CharFilter(field_name="module")

    class Meta:
        model = ProfilePermission
        fields: list[str] = []


class FieldPermissionFilter(django_filters.FilterSet):
    """Filter field permissions by profile / module / access."""

    profile = django_filters.NumberFilter(field_name="profile_id")
    module = django_filters.CharFilter(field_name="module")
    access = django_filters.CharFilter(field_name="access")

    class Meta:
        model = FieldPermission
        fields: list[str] = []
