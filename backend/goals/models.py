"""Database models for the goals app (Phase 16).

Two tenant-scoped models:

* :class:`Goal` — a (owner_type, owner_id, metric, period) target.
  ``owner_type`` ∈ {user, team, org}; ``owner_id`` is the user/team pk
  or the tenant pk for org-wide goals. ``metric`` ∈ {revenue,
  deals_closed, calls_made, emails_sent, meetings_held, leads_created,
  custom}. ``actual_amount`` is auto-refreshed by
  :func:`goals.services.refresh_all_goals` (Celery beat daily 1am).
  ``parent_goal`` enables org-level roll-ups from team/user goals.
* :class:`GoalAchievement` — gamification badges awarded by
  :func:`goals.services.check_achievements`.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import TenantModel, User

###############################################################################
# Constants — owner types + metrics + period types + badge types
###############################################################################

OWNER_USER = "user"
OWNER_TEAM = "team"
OWNER_ORG = "org"
OWNER_TYPE_CHOICES = [
    (OWNER_USER, "User"),
    (OWNER_TEAM, "Team"),
    (OWNER_ORG, "Org"),
]

METRIC_REVENUE = "revenue"
METRIC_DEALS_CLOSED = "deals_closed"
METRIC_CALLS_MADE = "calls_made"
METRIC_EMAILS_SENT = "emails_sent"
METRIC_MEETINGS_HELD = "meetings_held"
METRIC_LEADS_CREATED = "leads_created"
METRIC_CUSTOM = "custom"
METRIC_CHOICES = [
    (METRIC_REVENUE, "Revenue"),
    (METRIC_DEALS_CLOSED, "Deals Closed"),
    (METRIC_CALLS_MADE, "Calls Made"),
    (METRIC_EMAILS_SENT, "Emails Sent"),
    (METRIC_MEETINGS_HELD, "Meetings Held"),
    (METRIC_LEADS_CREATED, "Leads Created"),
    (METRIC_CUSTOM, "Custom"),
]

PERIOD_DAILY = "daily"
PERIOD_WEEKLY = "weekly"
PERIOD_MONTHLY = "monthly"
PERIOD_QUARTERLY = "quarterly"
PERIOD_YEARLY = "yearly"
PERIOD_TYPE_CHOICES = [
    (PERIOD_DAILY, "Daily"),
    (PERIOD_WEEKLY, "Weekly"),
    (PERIOD_MONTHLY, "Monthly"),
    (PERIOD_QUARTERLY, "Quarterly"),
    (PERIOD_YEARLY, "Yearly"),
]

BADGE_FIRST_DEAL = "first_deal"
BADGE_100K_DEALS = "100k_deals"
BADGE_100_CALLS_WEEK = "100_calls_week"
BADGE_TOP_PERFORMER_MONTH = "top_performer_month"
BADGE_TYPE_CHOICES = [
    (BADGE_FIRST_DEAL, "First Deal"),
    (BADGE_100K_DEALS, "100K Deals"),
    (BADGE_100_CALLS_WEEK, "100 Calls in a Week"),
    (BADGE_TOP_PERFORMER_MONTH, "Top Performer of the Month"),
]


###############################################################################
# Goal
###############################################################################


class Goal(TenantModel):
    """A measurable target for a (user | team | org) over a period.

    The ``actual_amount`` is auto-calculated by
    :func:`goals.services.calculate_actual` and refreshed by the daily
    Celery task :func:`goals.tasks.refresh_all_goals`. ``parent_goal``
    lets an org-level goal roll up team/user goals.
    """

    owner_type = models.CharField(
        max_length=8, choices=OWNER_TYPE_CHOICES, default=OWNER_USER, db_index=True
    )
    owner_id = models.CharField(max_length=32, db_index=True)
    metric = models.CharField(
        max_length=32, choices=METRIC_CHOICES, default=METRIC_REVENUE, db_index=True
    )
    period_type = models.CharField(
        max_length=16, choices=PERIOD_TYPE_CHOICES, default=PERIOD_MONTHLY, db_index=True
    )
    period_start = models.DateField(db_index=True)
    period_end = models.DateField(db_index=True)
    target_amount = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    actual_amount = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    is_active = models.BooleanField(default=True, db_index=True)
    parent_goal = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="child_goals",
        db_index=True,
    )

    class Meta:
        db_table = "goals_goal"
        verbose_name = "goal"
        verbose_name_plural = "goals"
        ordering = ["-period_start", "metric"]
        indexes = [
            models.Index(
                fields=["tenant", "owner_type", "owner_id", "period_start"],
                name="goal_owner_period_idx",
            ),
            models.Index(fields=["tenant", "metric", "period_type"], name="goal_metric_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.owner_type}:{self.owner_id} / {self.metric} / {self.period_type} {self.period_start}"


###############################################################################
# GoalAchievement
###############################################################################


class GoalAchievement(TenantModel):
    """A gamification badge awarded to a user by
    :func:`goals.services.check_achievements`.

    One row per (user, badge_type) — re-awarding the same badge is a
    no-op (the row already exists).
    """

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="goal_achievements",
        db_index=True,
    )
    badge_type = models.CharField(
        max_length=32, choices=BADGE_TYPE_CHOICES, db_index=True
    )
    awarded_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "goals_achievement"
        verbose_name = "goal achievement"
        verbose_name_plural = "goal achievements"
        ordering = ["-awarded_at"]
        unique_together = (("tenant", "user", "badge_type"),)
        indexes = [
            models.Index(fields=["tenant", "user"], name="goal_ach_user_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} / {self.badge_type}"


__all__ = [
    "BADGE_100_CALLS_WEEK",
    "BADGE_100K_DEALS",
    "BADGE_FIRST_DEAL",
    "BADGE_TOP_PERFORMER_MONTH",
    "BADGE_TYPE_CHOICES",
    "Goal",
    "GoalAchievement",
    "METRIC_CALLS_MADE",
    "METRIC_CHOICES",
    "METRIC_CUSTOM",
    "METRIC_DEALS_CLOSED",
    "METRIC_EMAILS_SENT",
    "METRIC_LEADS_CREATED",
    "METRIC_MEETINGS_HELD",
    "METRIC_REVENUE",
    "OWNER_ORG",
    "OWNER_TEAM",
    "OWNER_TYPE_CHOICES",
    "OWNER_USER",
    "PERIOD_DAILY",
    "PERIOD_MONTHLY",
    "PERIOD_QUARTERLY",
    "PERIOD_TYPE_CHOICES",
    "PERIOD_WEEKLY",
    "PERIOD_YEARLY",
]
