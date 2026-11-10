"""factory_boy factories for the tasks app."""

from __future__ import annotations

from datetime import timedelta

from django.utils import timezone
from factory import LazyFunction
from factory.django import DjangoModelFactory

from api.factories import _current_tenant, _current_user
from tasks.models import Task


class TaskFactory(DjangoModelFactory):
    class Meta:
        model = Task

    tenant = LazyFunction(_current_tenant)
    title = "Test task"
    description = "A test task."
    due_date = LazyFunction(lambda: timezone.now() + timedelta(days=1))
    reminder = None
    priority = "medium"
    status = "not_started"
    assignee = LazyFunction(_current_user)
    owner = LazyFunction(_current_user)
    created_by = LazyFunction(_current_user)
    recurrence = ""
    time_spent = 0
    timer_started_at = None
    checklist = LazyFunction(lambda: [{"text": "First step", "done": False}])
    tags = LazyFunction(lambda: ["phase-5"])
    last_activity = None


class RecurringTaskFactory(TaskFactory):
    """A recurring task whose due_date is in the past (good for beat tests)."""

    recurrence = "FREQ=DAILY;INTERVAL=1"
    due_date = LazyFunction(lambda: timezone.now() - timedelta(days=1))
