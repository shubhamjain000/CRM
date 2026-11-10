"""django-filter FilterSets for the custom_functions app."""

from __future__ import annotations

import django_filters

from .models import (
    CustomFunction,
    CustomFunctionExecution,
    HttpAllowlist,
    HttpCallLog,
    KVStore,
)


class CustomFunctionFilter(django_filters.FilterSet):
    """Filter custom functions by language / trigger / active / approved."""

    language = django_filters.CharFilter(field_name="language")
    trigger_event = django_filters.CharFilter(field_name="trigger_event")
    is_active = django_filters.BooleanFilter(field_name="is_active")
    is_approved = django_filters.BooleanFilter(field_name="is_approved")
    created_at__gte = django_filters.DateTimeFilter(
        field_name="created_at", lookup_expr="gte"
    )
    created_at__lte = django_filters.DateTimeFilter(
        field_name="created_at", lookup_expr="lte"
    )

    class Meta:
        model = CustomFunction
        fields: list[str] = []


class CustomFunctionExecutionFilter(django_filters.FilterSet):
    """Filter executions by function / status / trigger."""

    function = django_filters.NumberFilter(field_name="function_id")
    status = django_filters.CharFilter(field_name="status")
    trigger = django_filters.CharFilter(field_name="trigger")
    started_at__gte = django_filters.DateTimeFilter(
        field_name="started_at", lookup_expr="gte"
    )
    started_at__lte = django_filters.DateTimeFilter(
        field_name="started_at", lookup_expr="lte"
    )

    class Meta:
        model = CustomFunctionExecution
        fields: list[str] = []


class HttpAllowlistFilter(django_filters.FilterSet):
    """Filter allowlist entries by domain / active state."""

    domain = django_filters.CharFilter(field_name="domain", lookup_expr="icontains")
    is_active = django_filters.BooleanFilter(field_name="is_active")

    class Meta:
        model = HttpAllowlist
        fields: list[str] = []


class HttpCallLogFilter(django_filters.FilterSet):
    """Filter HTTP call logs by execution / status code."""

    function_execution = django_filters.NumberFilter(
        field_name="function_execution_id"
    )
    status_code = django_filters.NumberFilter(field_name="status_code")
    method = django_filters.CharFilter(field_name="method")
    created_at__gte = django_filters.DateTimeFilter(
        field_name="created_at", lookup_expr="gte"
    )

    class Meta:
        model = HttpCallLog
        fields: list[str] = []


class KVStoreFilter(django_filters.FilterSet):
    """Filter KV entries by key prefix."""

    key = django_filters.CharFilter(field_name="key", lookup_expr="istartswith")

    class Meta:
        model = KVStore
        fields: list[str] = []
