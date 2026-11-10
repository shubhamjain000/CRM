"""Model-layer tests for the goals app."""

from __future__ import annotations

from decimal import Decimal

import pytest

from goals.factories import GoalAchievementFactory, GoalFactory
from goals.models import (
    BADGE_FIRST_DEAL,
    Goal,
    GoalAchievement,
    METRIC_REVENUE,
    OWNER_TEAM,
    OWNER_USER,
    PERIOD_MONTHLY,
)


pytestmark = pytest.mark.django_db


def test_goal_defaults_and_str(active_tenant, user):  # type: ignore[no-untyped-def]
    goal = GoalFactory(
        tenant=active_tenant, owner_type=OWNER_USER, owner_id=str(user.pk)
    )
    assert goal.metric == METRIC_REVENUE
    assert goal.period_type == PERIOD_MONTHLY
    assert goal.is_active is True
    assert str(goal).startswith(f"user:{user.pk} / revenue")


def test_goal_self_reference_via_parent(active_tenant, user):  # type: ignore[no-untyped-def]
    parent = GoalFactory(
        tenant=active_tenant, owner_type=OWNER_TEAM, owner_id="7"
    )
    child = GoalFactory(
        tenant=active_tenant, owner_type=OWNER_USER, owner_id=str(user.pk),
        parent_goal=parent,
    )
    assert child.parent_goal_id == parent.pk
    assert list(parent.child_goals.all()) == [child]


def test_goal_cascade_delete_parent_removes_children(active_tenant, user):  # type: ignore[no-untyped-def]
    parent = GoalFactory(tenant=active_tenant, owner_type=OWNER_TEAM, owner_id="7")
    child = GoalFactory(
        tenant=active_tenant, owner_type=OWNER_USER, owner_id=str(user.pk),
        parent_goal=parent,
    )
    parent_pk = parent.pk
    parent.delete()
    assert Goal.objects.filter(pk=parent_pk).count() == 0
    assert Goal.objects.filter(pk=child.pk).count() == 0


def test_achievement_unique_per_user_badge(active_tenant, user):  # type: ignore[no-untyped-def]
    GoalAchievementFactory(
        tenant=active_tenant, user=user, badge_type=BADGE_FIRST_DEAL
    )
    with pytest.raises(Exception):  # noqa: PT011 — IntegrityError
        GoalAchievementFactory(
            tenant=active_tenant, user=user, badge_type=BADGE_FIRST_DEAL
        )
    assert (
        GoalAchievement.objects.filter(
            user=user, badge_type=BADGE_FIRST_DEAL
        ).count()
        == 1
    )
