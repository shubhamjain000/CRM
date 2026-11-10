"""django-filter FilterSets for the goals app."""

from __future__ import annotations

import django_filters

from .models import Goal, GoalAchievement


class GoalFilter(django_filters.FilterSet):
    """Filter goals by owner / metric / period / active."""

    owner_type = django_filters.CharFilter(field_name="owner_type")
    owner_id = django_filters.CharFilter(field_name="owner_id")
    metric = django_filters.CharFilter(field_name="metric")
    period_type = django_filters.CharFilter(field_name="period_type")
    period_start = django_filters.DateFilter(field_name="period_start")
    period_start__gte = django_filters.DateFilter(field_name="period_start", lookup_expr="gte")
    period_start__lte = django_filters.DateFilter(field_name="period_start", lookup_expr="lte")
    is_active = django_filters.BooleanFilter(field_name="is_active")
    parent_goal = django_filters.NumberFilter(field_name="parent_goal_id")

    class Meta:
        model = Goal
        fields: list[str] = []


class GoalAchievementFilter(django_filters.FilterSet):
    """Filter achievements by user / badge."""

    user = django_filters.NumberFilter(field_name="user_id")
    badge_type = django_filters.CharFilter(field_name="badge_type")

    class Meta:
        model = GoalAchievement
        fields: list[str] = []
