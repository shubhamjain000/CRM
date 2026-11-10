"""django-filter FilterSets for the sandbox app."""

from __future__ import annotations

import django_filters

from .models import Sandbox


class SandboxFilter(django_filters.FilterSet):
    """Filter sandboxes by branch / active."""

    branch_name = django_filters.CharFilter(field_name="branch_name", lookup_expr="icontains")
    is_active = django_filters.BooleanFilter(field_name="is_active")

    class Meta:
        model = Sandbox
        fields: list[str] = []
