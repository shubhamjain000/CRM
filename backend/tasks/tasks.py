"""Celery tasks for the tasks app.

Three beat-scheduled tasks (see ``config/settings.py``):

* :func:`generate_recurring_tasks` — daily at 03:00 UTC. Finds every recurring
  task whose next occurrence is due today and creates the next instance (with
  ``recurrence`` cleared so the new instance is a one-off). The original task's
  ``due_date`` is advanced to the next occurrence.
* :func:`send_task_reminders` — every 15 minutes. Finds tasks with
  ``reminder <= now()`` and ``reminder_sent_at IS NULL``, dispatches a
  notification, and stamps ``reminder_sent_at`` so the dispatch is idempotent.
* :func:`send_daily_digest` — daily at 08:00 UTC. Emails each user their
  due-today + overdue tasks.

All tasks iterate per-tenant via :func:`api.managers.tenant_context` so the
thread-local scoping (and the CRM activity-log writes from the signals) is
correct.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from celery import shared_task
from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from api.managers import tenant_context
from api.models import Organization, User

from .models import Task
from .services import next_recurrence, send_task_notification

log = logging.getLogger(__name__)


###############################################################################
# Recurring-task generation
###############################################################################


@shared_task(name="tasks.generate_recurring_tasks")
def generate_recurring_tasks() -> dict[str, Any]:
    """Advance recurring tasks to their next occurrence.

    For every recurring task whose ``due_date`` has passed (or is today), we:

    1. Compute the next occurrence datetime via :func:`tasks.services.next_recurrence`.
    2. Clone the task as a one-off (``recurrence=""``) at the *current* due_date
       so the historical instance is preserved.
    3. Advance the original task's ``due_date`` and ``reminder`` to the next
       occurrence.

    Idempotent across re-runs on the same day: the next-occurrence check is
    strictly greater than ``now()``, so a task already advanced today will
    not be advanced again until its new due_date passes.
    """
    now = timezone.now()
    today_end = now.replace(hour=23, minute=59, second=59, microsecond=0)
    summary: dict[str, Any] = {
        "tenants_processed": 0,
        "advanced": 0,
        "cloned": 0,
        "errors": [],
    }

    for org in Organization.objects.filter(is_active=True).iterator(chunk_size=200):
        with tenant_context(org):
            summary["tenants_processed"] += 1
            recurring = Task.objects.filter(
                ~Q(recurrence=""),
                deleted_at__isnull=True,
            ).iterator(chunk_size=200)
            for task in recurring:
                try:
                    due = task.due_date or now
                    if due > today_end:
                        # Not yet due — skip.
                        continue
                    nxt = next_recurrence(task, after=due)
                    if nxt is None:
                        continue
                    with transaction.atomic():
                        # Clone a one-off copy at the current due_date.
                        Task.objects.create(
                            tenant=task.tenant,
                            title=task.title,
                            description=task.description,
                            due_date=task.due_date,
                            priority=task.priority,
                            status=Task.STATUS_NOT_STARTED,
                            assignee=task.assignee,
                            owner=task.owner,
                            created_by=task.created_by,
                            parent_task=task.parent_task,
                            related_module=task.related_module,
                            related_id=task.related_id,
                            recurrence="",
                            checklist=task.checklist,
                            tags=task.tags,
                        )
                        # Advance the original.
                        delta = nxt - due
                        task.due_date = nxt
                        if task.reminder:
                            task.reminder = task.reminder + delta
                        task.reminder_sent_at = None
                        task.save(update_fields=[
                            "due_date",
                            "reminder",
                            "reminder_sent_at",
                            "updated_at",
                        ])
                    summary["advanced"] += 1
                    summary["cloned"] += 1
                except Exception as exc:  # pragma: no cover — defensive
                    log.exception("generate_recurring_tasks: failed on task %s", task.pk)
                    summary["errors"].append({"task_id": task.pk, "error": str(exc)})

    log.info(
        "generate_recurring_tasks: tenants=%s advanced=%s cloned=%s",
        summary["tenants_processed"], summary["advanced"], summary["cloned"],
    )
    return summary


###############################################################################
# Task reminders
###############################################################################


@shared_task(name="tasks.send_task_reminders")
def send_task_reminders() -> dict[str, Any]:
    """Fire reminders for tasks whose ``reminder`` time has arrived.

    Selects tasks with ``reminder <= now()`` AND ``reminder_sent_at IS NULL``
    across every active tenant. For each, dispatches a notification and stamps
    ``reminder_sent_at`` so the task isn't reminded twice.
    """
    now = timezone.now()
    summary: dict[str, Any] = {
        "tenants_processed": 0,
        "reminders_sent": 0,
        "errors": [],
    }

    for org in Organization.objects.filter(is_active=True).iterator(chunk_size=200):
        with tenant_context(org):
            summary["tenants_processed"] += 1
            due = (
                Task.objects.select_related("assignee", "owner")
                .filter(
                    reminder__lte=now,
                    reminder_sent_at__isnull=True,
                    deleted_at__isnull=True,
                    status__in=(Task.STATUS_NOT_STARTED, Task.STATUS_IN_PROGRESS, Task.STATUS_DEFERRED),
                )
                .iterator(chunk_size=200)
            )
            for task in due:
                try:
                    send_task_notification(
                        user=task.assignee,
                        subject=f"Task reminder: {task.title}",
                        body=task.description or task.title,
                        task=task,
                    )
                    task.mark_reminded()
                    summary["reminders_sent"] += 1
                except Exception as exc:  # pragma: no cover — defensive
                    log.exception("send_task_reminders: failed on task %s", task.pk)
                    summary["errors"].append({"task_id": task.pk, "error": str(exc)})

    log.info(
        "send_task_reminders: tenants=%s sent=%s",
        summary["tenants_processed"], summary["reminders_sent"],
    )
    return summary


###############################################################################
# Daily digest
###############################################################################


@shared_task(name="tasks.send_daily_digest")
def send_daily_digest() -> dict[str, Any]:
    """Email each user a digest of their due-today + overdue tasks.

    Iterates per-tenant so the ORM tenant scoping is correct, then groups the
    user's tasks into ``overdue`` / ``due_today`` / ``due_this_week`` buckets
    and emails a plain-text summary.
    """
    now = timezone.now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    week_end = today_end + timedelta(days=6)

    summary: dict[str, Any] = {
        "tenants_processed": 0,
        "users_processed": 0,
        "emails_sent": 0,
        "errors": [],
    }
    processed_users: set[int] = set()

    for org in Organization.objects.filter(is_active=True).iterator(chunk_size=200):
        with tenant_context(org):
            summary["tenants_processed"] += 1
            # Every user with an active membership in this tenant.
            user_ids = list(
                User.objects.filter(
                    memberships__tenant=org,
                    memberships__is_active=True,
                    is_active_account=True,
                )
                .distinct()
                .values_list("pk", flat=True)
            )
            for user_id in user_ids:
                if user_id in processed_users:
                    continue
                processed_users.add(user_id)
                summary["users_processed"] += 1
                user = User.objects.get(pk=user_id)
                try:
                    _send_digest_for_user(
                        user=user,
                        org=org,
                        now=now,
                        today_start=today_start,
                        today_end=today_end,
                        week_end=week_end,
                    )
                    summary["emails_sent"] += 1
                except Exception as exc:  # pragma: no cover — depends on SMTP
                    log.exception("send_daily_digest: failed for user %s", user.pk)
                    summary["errors"].append({"user_id": user.pk, "error": str(exc)})

    log.info(
        "send_daily_digest: tenants=%s users=%s emails=%s",
        summary["tenants_processed"], summary["users_processed"], summary["emails_sent"],
    )
    return summary


def _send_digest_for_user(
    *,
    user: User,
    org: Organization,
    now: Any,
    today_start: Any,
    today_end: Any,
    week_end: Any,
) -> None:
    """Build + send the daily digest email for ``user`` scoped to ``org``."""
    with tenant_context(org):
        open_statuses = (
            Task.STATUS_NOT_STARTED,
            Task.STATUS_IN_PROGRESS,
            Task.STATUS_DEFERRED,
        )
        overdue = list(
            Task.objects.filter(
                assignee=user,
                status__in=open_statuses,
                due_date__lt=today_start,
                deleted_at__isnull=True,
            ).order_by("due_date")
        )
        due_today = list(
            Task.objects.filter(
                assignee=user,
                status__in=open_statuses,
                due_date__gte=today_start,
                due_date__lt=today_end,
                deleted_at__isnull=True,
            ).order_by("due_date")
        )
        due_this_week = list(
            Task.objects.filter(
                assignee=user,
                status__in=open_statuses,
                due_date__gte=today_end,
                due_date__lt=week_end,
                deleted_at__isnull=True,
            ).order_by("due_date")
        )

    if not (overdue or due_today or due_this_week):
        return

    lines: list[str] = [f"Hi {user.name or user.email},", ""]
    lines.append("Here's your task digest for today.")
    lines.append("")

    def _section(name: str, tasks: list[Task]) -> None:
        if not tasks:
            return
        lines.append(f"== {name} ({len(tasks)}) ==")
        for t in tasks:
            due = t.due_date.strftime("%Y-%m-%d %H:%M") if t.due_date else "no due date"
            lines.append(f"  - [{t.priority}] {t.title} (due {due})")
        lines.append("")

    _section("Overdue", overdue)
    _section("Due today", due_today)
    _section("Due this week", due_this_week)
    body = "\n".join(lines)

    send_mail(
        subject=f"[{org.name}] Your task digest for {now.strftime('%Y-%m-%d')}",
        message=body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        fail_silently=False,
    )
