"""Scheduled-actions service layer.

:class:`ScheduledActionsService` is the canonical interface used by the
Celery beat task and the viewset ``run_now`` action. It centralises:

* :meth:`compute_next_run` — turn a cron expression + timezone into the
  next ``datetime`` (via :mod:`croniter`).
* :meth:`run_due_jobs` — find every active job whose ``next_run_at`` is
  due, dispatch each, and re-compute ``next_run_at``.
* :meth:`run_job` — dispatch a single job (re-uses
  :class:`workflows.services.WorkflowService.execute_action`).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from django.db.models import Q
from django.utils import timezone

from .models import (
    LOG_STATUS_FAILED,
    LOG_STATUS_SUCCESS,
    ScheduledJob,
    ScheduledJobLog,
)

log = logging.getLogger(__name__)


###############################################################################
# Service
###############################################################################


class ScheduledActionsService:
    """Stateless service encapsulating the scheduled-actions engine."""

    # ------------------------------------------------------------------ cron

    def compute_next_run(
        self, cron_expression: str, tz_name: str = "UTC", after: datetime | None = None
    ) -> datetime:
        """Return the next run datetime for ``cron_expression`` in ``tz_name``.

        Falls back to a 1-minute recurrence when :mod:`croniter` isn't
        installed so the beat task keeps making progress in dev.
        """
        try:
            from croniter import croniter
        except ImportError:  # pragma: no cover — croniter optional in dev
            log.warning("croniter not installed; falling back to +1 minute.")
            base = after or timezone.now()
            return base + timedelta(seconds=60)
        tz = self._resolve_tz(tz_name)
        base = after or datetime.now(tz)
        if base.tzinfo is None:
            base = base.replace(tzinfo=tz)
        next_dt = croniter(cron_expression, base).get_next(datetime)
        if next_dt.tzinfo is None:
            next_dt = next_dt.replace(tzinfo=tz)
        return next_dt

    @staticmethod
    def _resolve_tz(tz_name: str) -> ZoneInfo:
        try:
            return ZoneInfo(tz_name)
        except Exception:  # pragma: no cover — defensive: bad tz string
            return ZoneInfo("UTC")

    # ------------------------------------------------------------------ run_due_jobs

    def run_due_jobs(self, now: datetime | None = None) -> dict[str, Any]:
        """Find every active job whose ``next_run_at`` is due + dispatch each.

        Returns a summary ``{checked, ran, failed}`` for the beat-task log.
        """
        now = now or timezone.now()
        summary: dict[str, Any] = {"checked": 0, "ran": 0, "failed": 0}
        qs = ScheduledJob.objects.filter(status="active").filter(
            Q(next_run_at__isnull=True) | Q(next_run_at__lte=now)
        )
        for job in qs.iterator(chunk_size=200):
            summary["checked"] += 1
            try:
                self.run_job(job)
                summary["ran"] += 1
            except Exception:  # pragma: no cover — defensive
                summary["failed"] += 1
                log.exception("run_due_jobs: job %s failed", job.pk)
        return summary

    # ------------------------------------------------------------------ run_job

    def run_job(self, job: ScheduledJob) -> ScheduledJobLog:
        """Dispatch ``job`` + record a :class:`ScheduledJobLog` row.

        The action is re-run via
        :class:`workflows.services.WorkflowService.execute_action` so the
        scheduled engine reuses the same per-type dispatch table as the
        workflow engine. A throwaway :class:`WorkflowAction` is constructed
        in-memory (not persisted) so the existing dispatch path works
        unchanged.
        """
        from workflows.models import WorkflowAction
        from workflows.services import WorkflowService

        started = timezone.now()
        log_row = ScheduledJobLog.objects.create(
            tenant=job.tenant,
            job=job,
            started_at=started,
            status=LOG_STATUS_SUCCESS,
        )
        try:
            action = WorkflowAction(
                tenant=job.tenant,
                rule=None,
                order=0,
                action_type=job.action_type,
                config=job.config or {},
            )
            context = self._build_context(job)
            result = WorkflowService().execute_action(action, context)
            log_row.result = result if isinstance(result, dict) else {"value": result}
            log_row.status = LOG_STATUS_SUCCESS
        except Exception as exc:  # noqa: BLE001 — capture any dispatch error
            log_row.status = LOG_STATUS_FAILED
            log_row.error_message = str(exc)
            log_row.result = {"error": str(exc)}
            log.exception("run_job: action %s failed for job %s", job.action_type, job.pk)
        log_row.completed_at = timezone.now()
        log_row.save(update_fields=["status", "error_message", "result", "completed_at", "updated_at"])
        # Stamp the job's last_run_at + recompute next_run_at.
        job.last_run_at = started
        job.next_run_at = self.compute_next_run(
            job.cron_expression, job.timezone or "UTC", after=started
        )
        job.save(update_fields=["last_run_at", "next_run_at", "updated_at"])
        return log_row

    # ------------------------------------------------------------------ context

    def _build_context(self, job: ScheduledJob) -> dict[str, Any]:
        """Build the execution context for a scheduled job.

        Scheduled jobs are not tied to a specific record (they run on a
        schedule), so the context carries the tenant + job metadata but
        ``record`` / ``record_data`` are empty. Actions that require a
        record (``update_field``, ``add_tag``) will skip gracefully.
        """
        return {
            "rule": None,
            "tenant": job.tenant,
            "target_module": "",
            "target_id": "",
            "record": None,
            "record_data": {},
        }


__all__ = ["ScheduledActionsService"]
