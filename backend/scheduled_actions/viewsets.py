"""DRF ViewSets for the scheduled_actions app.

:class:`ScheduledJobViewSet` — CRUD on :class:`ScheduledJob` plus:
``pause`` / ``resume`` / ``run_now`` / ``logs``.

:class:`ScheduledJobLogViewSet` — read-only list / retrieve.
"""

from __future__ import annotations

from typing import Any

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet, ReadOnlyModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember
from scheduled_actions.filters import ScheduledJobFilter, ScheduledJobLogFilter
from scheduled_actions.models import ScheduledJob, ScheduledJobLog
from scheduled_actions.serializers import (
    ScheduledJobLogSerializer,
    ScheduledJobSerializer,
)
from scheduled_actions.services import ScheduledActionsService


class ScheduledJobViewSet(ModelViewSet):
    """CRUD + lifecycle / run-now / logs actions for :class:`ScheduledJob`."""

    pagination_class = CRMCursorPagination
    serializer_class = ScheduledJobSerializer
    filterset_class = ScheduledJobFilter
    queryset = ScheduledJob.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        if self.action in ("list", "retrieve", "logs"):
            return [IsAuthenticated(), IsTenantMember()]
        return [
            IsAuthenticated(),
            IsTenantMember(),
            HasPermission("scheduled_actions.manage"),
        ]

    def get_queryset(self) -> Any:
        qs = super().get_queryset()
        params = self.request.query_params
        job_status = params.get("status")
        if job_status:
            qs = qs.filter(status=job_status)
        action_type = params.get("action_type")
        if action_type:
            qs = qs.filter(action_type=action_type)
        return qs

    def perform_create(self, serializer: ScheduledJobSerializer) -> None:  # type: ignore[override]
        job = serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]
        # Stamp the initial next_run_at so the beat task picks it up.
        next_run = ScheduledActionsService().compute_next_run(
            job.cron_expression, job.timezone or "UTC"
        )
        job.next_run_at = next_run
        job.save(update_fields=["next_run_at", "updated_at"])

    # ------------------------------------------------------------------ lifecycle

    @action(detail=True, methods=["post"], url_path="pause")
    def pause(self, request: Request, pk: str | None = None) -> Response:
        job: ScheduledJob = self.get_object()  # type: ignore[assignment]
        job.status = "paused"
        job.save(update_fields=["status", "updated_at"])
        return Response(self.get_serializer(job).data)

    @action(detail=True, methods=["post"], url_path="resume")
    def resume(self, request: Request, pk: str | None = None) -> Response:
        job: ScheduledJob = self.get_object()  # type: ignore[assignment]
        job.status = "active"
        job.next_run_at = ScheduledActionsService().compute_next_run(
            job.cron_expression, job.timezone or "UTC"
        )
        job.save(update_fields=["status", "next_run_at", "updated_at"])
        return Response(self.get_serializer(job).data)

    @action(detail=True, methods=["post"], url_path="run-now")
    def run_now(self, request: Request, pk: str | None = None) -> Response:
        """Dispatch the job immediately (regardless of schedule) + return the log."""
        job: ScheduledJob = self.get_object()  # type: ignore[assignment]
        log_row = ScheduledActionsService().run_job(job)
        return Response(ScheduledJobLogSerializer(log_row).data)

    @action(detail=True, methods=["get"], url_path="logs")
    def logs(self, request: Request, pk: str | None = None) -> Response:
        job: ScheduledJob = self.get_object()  # type: ignore[assignment]
        qs = ScheduledJobLog.objects.filter(job=job).order_by("-started_at")
        page = self.paginate_queryset(qs)
        serializer = ScheduledJobLogSerializer(page, many=True)
        return self.get_paginated_response(serializer.data)


class ScheduledJobLogViewSet(ReadOnlyModelViewSet):
    """Read-only list / retrieve for :class:`ScheduledJobLog`."""

    pagination_class = CRMCursorPagination
    serializer_class = ScheduledJobLogSerializer
    filterset_class = ScheduledJobLogFilter
    permission_classes = [IsAuthenticated, IsTenantMember]
    queryset = ScheduledJobLog.objects.select_related("job", "tenant")

    def get_queryset(self) -> Any:
        qs = super().get_queryset()
        params = self.request.query_params
        job = params.get("job")
        if job:
            qs = qs.filter(job_id=job)
        log_status = params.get("status")
        if log_status:
            qs = qs.filter(status=log_status)
        return qs


__all__ = ["ScheduledJobLogViewSet", "ScheduledJobViewSet"]
