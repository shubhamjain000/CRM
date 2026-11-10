"""Goals app — targets + gamification badges.

Phase 16 delivers Salesforce-style quotas and gamification:

* :class:`Goal` — a (owner_type, owner_id, metric, period) target with
  ``target_amount`` and ``actual_amount``. Supports user / team / org
  scopes, daily → yearly periods, and a self-referential ``parent_goal``
  for org-level roll-ups. The ``actual_amount`` is auto-refreshed by the
  Celery beat task :func:`goals.tasks.refresh_all_goals` (daily 1am).
* :class:`GoalAchievement` — gamification badges (first_deal /
  100k_deals / 100_calls_week / top_performer_month).
"""
