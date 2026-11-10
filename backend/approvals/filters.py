"""django-filter FilterSets for the approvals app."""

from __future__ import annotations

import django_filters

from approvals.models import ApprovalDelegation, ApprovalProcess, ApprovalRequest


class ApprovalProcessFilter(django_filters.FilterSet):
    """Filter approval processes by target_model / active / name."""

    target_model = django_filters.CharFilter(field_name="target_model")
    is_active = django_filters.BooleanFilter(field_name="is_active")
    name = django_filters.CharFilter(lookup_expr="icontains")
    created_at__gte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = django_filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")

    class Meta:
        model = ApprovalProcess
        fields: list[str] = []


class ApprovalRequestFilter(django_filters.FilterSet):
    """Filter approval requests by status / submitter / target / process."""

    status = django_filters.CharFilter(field_name="status")
    submitted_by = django_filters.NumberFilter(field_name="submitted_by_id")
    process = django_filters.NumberFilter(field_name="process_id")
    target_module = django_filters.CharFilter(field_name="target_module")
    target_id = django_filters.CharFilter(field_name="target_id")
    current_step = django_filters.NumberFilter(field_name="current_step_id")
    submitted_at__gte = django_filters.DateTimeFilter(
        field_name="submitted_at", lookup_expr="gte"
    )
    submitted_at__lte = django_filters.DateTimeFilter(
        field_name="submitted_at", lookup_expr="lte"
    )

    class Meta:
        model = ApprovalRequest
        fields: list[str] = []


class ApprovalDelegationFilter(django_filters.FilterSet):
    """Filter delegations by user / delegate / active."""

    user = django_filters.NumberFilter(field_name="user_id")
    delegate_to = django_filters.NumberFilter(field_name="delegate_to_id")
    is_active = django_filters.BooleanFilter(field_name="is_active")
    start_date__gte = django_filters.DateFilter(field_name="start_date", lookup_expr="gte")
    end_date__lte = django_filters.DateFilter(field_name="end_date", lookup_expr="lte")

    class Meta:
        model = ApprovalDelegation
        fields: list[str] = []
