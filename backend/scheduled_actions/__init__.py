"""Scheduled-actions app — cron-driven recurring jobs (Phase 11).

A :class:`ScheduledJob` is a tenant-scoped cron entry that re-runs a
single workflow action (or a small action config) on a recurring
schedule. The Celery beat task :func:`scheduled_actions.tasks.run_scheduled_jobs`
runs every minute, finds every active job whose ``next_run_at`` is due,
dispatches it, and re-computes ``next_run_at`` from the cron expression.

Every run is logged in :class:`ScheduledJobLog`.
"""
