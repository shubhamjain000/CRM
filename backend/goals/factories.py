"""factory_boy factories for the goals app."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import factory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant, _current_user

from .models import (
    BADGE_FIRST_DEAL,
    Goal,
    GoalAchievement,
    METRIC_REVENUE,
    OWNER_USER,
    PERIOD_MONTHLY,
)


def _month_start() -> date:
    return date.today().replace(day=1)


def _month_end() -> date:
    start = _month_start()
    return (start.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)


def _user_id_str() -> str:
    return str(_current_user().pk)


class GoalFactory(DjangoModelFactory):
    """Factory for :class:`Goal`."""

    class Meta:
        model = Goal

    tenant = factory.LazyFunction(_current_tenant)
    owner_type = OWNER_USER
    owner_id = factory.LazyFunction(_user_id_str)
    metric = METRIC_REVENUE
    period_type = PERIOD_MONTHLY
    period_start = factory.LazyFunction(_month_start)
    period_end = factory.LazyFunction(_month_end)
    target_amount = Decimal("100000.00")
    actual_amount = Decimal("0")
    is_active = True
    parent_goal = None


class GoalAchievementFactory(DjangoModelFactory):
    """Factory for :class:`GoalAchievement`."""

    class Meta:
        model = GoalAchievement

    tenant = factory.LazyFunction(_current_tenant)
    user = factory.LazyFunction(_current_user)
    badge_type = BADGE_FIRST_DEAL


__all__ = ["GoalAchievementFactory", "GoalFactory"]
