"""DRF ViewSet for the tasks app.

Provides CRUD + custom actions: ``complete``, ``defer``, ``add_subtask``,
``start_timer``, ``stop_timer``, ``bulk_update``. Cursor pagination, sort
whitelist, and tenant scoping come from the shared
:class:`api.crm_base.CRMModelViewSet`.
"""

from __future__ import annotations

from typing import Any, Iterable

from django.db import transaction
from django.db.models import Model
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from api.crm_base import CRMModelViewSet
from api.permissions import HasPermission, IsTenantMember
from tasks.filters import TaskFilter
from tasks.models import Task
from tasks.serializers import (
    SubtaskCreateSerializer,
    TaskBulkUpdateSerializer,
    TaskSerializer,
)


class TaskViewSet(CRMModelViewSet):
    """CRUD + productivity actions for :class:`tasks.models.Task`."""

    serializer_class = TaskSerializer
    queryset = Task.objects.all().select_related("assignee", "owner", "created_by", "parent_task")
    filterset_class = TaskFilter
    sort_fields: tuple[str, ...] = (
        "id",
        "title",
        "due_date",
        "priority",
        "status",
        "assignee",
        "owner",
        "last_activity",
        "created_at",
        "updated_at",
    )
    bulk_update_fields: tuple[str, ...] = (
        "status",
        "priority",
        "due_date",
        "reminder",
    )
    required_permission: Iterable[str] | str = "crm.tasks.read"

    def get_permissions(self) -> Any:
        method = self.request.method or ""
        if method in ("GET", "HEAD", "OPTIONS"):
            perm = "crm.tasks.read"
        elif method == "POST":
            perm = "crm.tasks.create"
        elif method in ("PUT", "PATCH"):
            perm = "crm.tasks.update"
        elif method == "DELETE":
            perm = "crm.tasks.delete"
        else:
            return [IsAuthenticated(), IsTenantMember()]
        return [IsAuthenticated(), IsTenantMember(), HasPermission(perm)]

    def perform_create(self, serializer: TaskSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    # ------------------------------------------------------------------ complete / defer

    @action(detail=True, methods=["post"], url_path="complete")
    def complete(self, request: Request, pk: str | None = None) -> Response:
        """Mark the task as completed."""
        task: Task = self.get_object()
        task.mark_complete()
        return Response(TaskSerializer(task, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="defer")
    def defer(self, request: Request, pk: str | None = None) -> Response:
        """Mark the task as deferred."""
        task: Task = self.get_object()
        task.mark_deferred()
        return Response(TaskSerializer(task, context={"request": request}).data)

    # ------------------------------------------------------------------ subtasks

    @action(detail=True, methods=["post"], url_path="add-subtask")
    def add_subtask(self, request: Request, pk: str | None = None) -> Response:
        """Create a subtask of this task (sets ``parent_task``)."""
        parent: Task = self.get_object()
        serializer = SubtaskCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            subtask = Task.objects.create(
                tenant=parent.tenant,
                title=data["title"],
                description=data.get("description", ""),
                due_date=data.get("due_date"),
                priority=data.get("priority", parent.priority),
                assignee=data.get("assignee") or parent.assignee,
                owner=parent.owner,
                created_by=request.user,
                parent_task=parent,
                related_module=parent.related_module,
                related_id=parent.related_id,
            )
        return Response(
            TaskSerializer(subtask, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    # ------------------------------------------------------------------ timers

    @action(detail=True, methods=["post"], url_path="start-timer")
    def start_timer(self, request: Request, pk: str | None = None) -> Response:
        """Start the timer on a task (sets ``timer_started_at``)."""
        task: Task = self.get_object()
        if task.timer_started_at is not None:
            return Response(
                {"detail": "Timer already running."},
                status=status.HTTP_409_CONFLICT,
            )
        task.timer_started_at = timezone.now()
        if task.status == Task.STATUS_NOT_STARTED:
            task.status = Task.STATUS_IN_PROGRESS
        task.last_activity = task.timer_started_at
        task.save(update_fields=["timer_started_at", "status", "last_activity", "updated_at"])
        return Response(TaskSerializer(task, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="stop-timer")
    def stop_timer(self, request: Request, pk: str | None = None) -> Response:
        """Stop the timer on a task (accumulates elapsed seconds)."""
        task: Task = self.get_object()
        if task.timer_started_at is None:
            return Response(
                {"detail": "Timer is not running."},
                status=status.HTTP_409_CONFLICT,
            )
        elapsed = int((timezone.now() - task.timer_started_at).total_seconds())
        task.time_spent = (task.time_spent or 0) + max(elapsed, 0)
        task.timer_started_at = None
        task.last_activity = timezone.now()
        task.save(
            update_fields=["time_spent", "timer_started_at", "last_activity", "updated_at"]
        )
        return Response(TaskSerializer(task, context={"request": request}).data)

    # ------------------------------------------------------------------ bulk update

    @action(detail=False, methods=["post"], url_path="bulk-update")
    def bulk_update(self, request: Request) -> Response:
        """POST ``{"ids": [...], "fields": {...}}`` to patch many tasks at once."""
        serializer = TaskBulkUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ids = serializer.validated_data["ids"]
        fields = serializer.validated_data["fields"]
        if not fields:
            return Response(
                {"detail": "fields must be a non-empty object."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        disallowed = set(fields) - set(self.bulk_update_fields)
        if disallowed:
            return Response(
                {"detail": f"Cannot bulk-update fields: {sorted(disallowed)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        queryset = self.filter_queryset(self.get_queryset()).filter(pk__in=ids)
        with transaction.atomic():
            updated = queryset.update(**fields)
            # Stamp last_activity on every updated row.
            queryset.update(last_activity=timezone.now())
        return Response({"updated": updated})

    # ------------------------------------------------------------------ merge override (no-op)

    def _merge(self, source: Model, target: Model) -> None:  # type: ignore[override]
        """Tasks cannot be merged — base ``merge`` action is therefore a no-op.

        The base viewset still exposes the endpoint for symmetry, but the body
        is intentionally empty. Subtasks are *not* re-parented by default —
        clients that want that behaviour should call ``add-subtask`` explicitly.
        """
        return None
