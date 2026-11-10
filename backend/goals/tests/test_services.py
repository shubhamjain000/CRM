"""Service-layer tests for the goals app."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from deals.factories import DealFactory, WonStageFactory
from goals.factories import GoalFactory
from goals.models import (
    BADGE_100K_DEALS,
    BADGE_FIRST_DEAL,
    METRIC_DEALS_CLOSED,
    METRIC_REVENUE,
    OWNER_ORG,
    OWNER_USER,
    PERIOD_MONTHLY,
    Goal,
)
from goals.services import (
    calculate_actual,
    get_goal_progress,
    get_leaderboard,
    period_bounds,
    refresh_all_goals,
)


pytestmark = pytest.mark.django_db


def test_period_bounds_monthly():  # type: ignore[no-untyped-def]
    start, end = period_bounds("monthly", date(2024, 3, 15))
    assert start == date(2024, 3, 1)
    assert end == date(2024, 3, 31)


def test_calculate_actual_revenue_sums_won_deals(active_tenant, user):  # type: ignore[no-untyped-def]
    won_stage = WonStageFactory(tenant=active_tenant)
    DealFactory(
        tenant=active_tenant, owner=user, stage=won_stage,
        amount=Decimal("5000"), close_date=date.today(),
    )
    DealFactory(
        tenant=active_tenant, owner=user, stage=won_stage,
        amount=Decimal("3000"), close_date=date.today(),
    )
    start, end = period_bounds(PERIOD_MONTHLY)
    goal = GoalFactory(
        tenant=active_tenant, owner_type=OWNER_USER, owner_id=str(user.pk),
        metric=METRIC_REVENUE, period_start=start, period_end=end,
        target_amount=Decimal("50000"),
    )
    actual = calculate_actual(goal)
    assert actual == Decimal("8000")


def test_refresh_all_goals_updates_actual_amount(active_tenant, user):  # type: ignore[no-untyped-def]
    won_stage = WonStageFactory(tenant=active_tenant)
    DealFactory(
        tenant=active_tenant, owner=user, stage=won_stage,
        amount=Decimal("10000"), close_date=date.today(),
    )
    start, end = period_bounds(PERIOD_MONTHLY)
    goal = GoalFactory(
        tenant=active_tenant, owner_type=OWNER_USER, owner_id=str(user.pk),
        metric=METRIC_REVENUE, period_start=start, period_end=end,
        actual_amount=Decimal("0"),
    )
    result = refresh_all_goals(tenant=active_tenant)
    assert result["refreshed"] >= 1
    goal.refresh_from_db()
    assert goal.actual_amount == Decimal("10000")


def test_get_goal_progress_reports_status(active_tenant, user):  # type: ignore[no-untyped-def]
    start, end = period_bounds(PERIOD_MONTHLY)
    GoalFactory(
        tenant=active_tenant, owner_type=OWNER_USER, owner_id=str(user.pk),
        metric=METRIC_REVENUE, period_start=start, period_end=end,
        target_amount=Decimal("10000"), actual_amount=Decimal("2500"),
    )
    progress = get_goal_progress(user, METRIC_REVENUE, PERIOD_MONTHLY, tenant=active_tenant)
    assert progress["found"] is True
    assert progress["percentage"] == 25.0
    assert progress["status"] == "behind"


def test_get_goal_progress_not_found(active_tenant, user):  # type: ignore[no-untyped-def]
    progress = get_goal_progress(
        user, METRIC_DEALS_CLOSED, PERIOD_MONTHLY, tenant=active_tenant
    )
    assert progress["found"] is False
    assert progress["status"] == "behind"


def test_get_leaderboard_returns_sorted_users(active_tenant, user):  # type: ignore[no-untyped-def]
    start, end = period_bounds(PERIOD_MONTHLY)
    GoalFactory(
        tenant=active_tenant, owner_type=OWNER_USER, owner_id=str(user.pk),
        metric=METRIC_REVENUE, period_start=start, period_end=end,
        actual_amount=Decimal("5000"),
    )
    board = get_leaderboard(METRIC_REVENUE, PERIOD_MONTHLY, tenant=active_tenant)
    assert len(board) >= 1
    assert board[0]["rank"] == 1
    assert board[0]["user_id"] == user.pk
