"""DRF ViewSets for the reports app.

* :class:`ReportViewSet` — CRUD + ``execute`` / ``export`` / ``duplicate`` /
  ``subscribe`` / ``share`` / ``preview`` actions.
* :class:`ReportFolderViewSet` — CRUD on folders.
* :class:`ReportExecutionViewSet` — list / retrieve + ``rerun``.
"""

from __future__ import annotations

import logging
from typing import Any

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember
from reports.filters import (
    ReportExecutionFilter,
    ReportFilter,
    ReportFolderFilter,
)
from reports.models import (
    Report,
    ReportExecution,
    ReportFolder,
    ReportSubscription,
)
from reports.serializers import (
    ReportExecutionSerializer,
    ReportFolderSerializer,
    ReportSerializer,
    ReportSubscriptionSerializer,
)
from reports.services import ReportService, report_service

log = logging.getLogger(__name__)


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve", "execute", "export", "preview"):
        return [IsAuthenticated(), IsTenantMember()]
    return [IsAuthenticated(), IsTenantMember(), HasPermission("reports.manage")]


###############################################################################
# ReportViewSet
###############################################################################


class ReportViewSet(ModelViewSet):
    """CRUD + lifecycle actions on :class:`Report`."""

    pagination_class = CRMCursorPagination
    serializer_class = ReportSerializer
    filterset_class = ReportFilter
    queryset = Report.objects.select_related("tenant", "created_by", "folder")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: ReportSerializer
    ) -> None:
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant, created_by=self.request.user
        )

    def get_queryset(self) -> Any:  # type: ignore[override]
        qs = super().get_queryset()
        # Readers see active reports; writers see all.
        if self.action in ("list", "retrieve", "execute", "export", "preview"):
            if self.request.query_params.get("include_inactive") != "true":
                qs = qs.filter(is_active=True)
        return qs

    @action(detail=True, methods=["post", "get"], url_path="execute")
    def execute(self, request: Request, pk: str | None = None) -> Response:
        """Execute the report — POST body accepts ``{limit, offset}``."""
        report: Report = self.get_object()  # type: ignore[assignment]
        limit = request.data.get("limit") if request.method == "POST" else request.query_params.get("limit")
        offset = (
            request.data.get("offset") if request.method == "POST"
            else request.query_params.get("offset")
        )
        try:
            result = report_service.execute_report(
                report,
                limit=int(limit) if limit is not None else None,
                offset=int(offset) if offset is not None else None,
                user=request.user,
            )
        except Exception as exc:  # pragma: no cover — defensive
            log.exception("execute: report %s failed", report.pk)
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result)

    @action(detail=True, methods=["get"], url_path="export")
    def export(self, request: Request, pk: str | None = None) -> Response:
        """GET ``?format=csv|xlsx|pdf|json&limit=...`` — stream the export."""
        from django.http import HttpResponse  # noqa: PLC0415

        report: Report = self.get_object()  # type: ignore[assignment]
        fmt = request.query_params.get("format", "csv")
        limit = request.query_params.get("limit")
        try:
            payload = report_service.export_report(
                report,
                fmt=fmt,
                limit=int(limit) if limit else None,
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        content_types = {
            "csv": "text/csv",
            "json": "application/json",
            "xlsx": "application/vnd.ms-excel",
            "pdf": "application/pdf",
        }
        response = HttpResponse(
            payload, content_type=content_types.get(fmt, "application/octet-stream")
        )
        response["Content-Disposition"] = f'attachment; filename="report-{report.pk}.{fmt}"'
        return response

    @action(detail=True, methods=["post"], url_path="duplicate")
    def duplicate(self, request: Request, pk: str | None = None) -> Response:
        """Deep-copy the report (new name + ``is_published=False``)."""
        report: Report = self.get_object()  # type: ignore[assignment]
        clone = Report.objects.get(pk=report.pk)
        clone.pk = None
        clone.name = f"{report.name} (copy)"
        clone.is_published = False
        clone.created_by = request.user
        clone.tenant = report.tenant
        clone.save()
        return Response(ReportSerializer(clone).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post", "delete"], url_path="subscribe")
    def subscribe(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{email_on_run?: bool}`` subscribes the caller; DELETE unsubscribes."""
        report: Report = self.get_object()  # type: ignore[assignment]
        if request.method == "DELETE":
            ReportSubscription.objects.filter(report=report, user=request.user).delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        sub, created = ReportSubscription.objects.get_or_create(
            report=report,
            user=request.user,
            defaults={
                "tenant": report.tenant,
                "email_on_run": bool(request.data.get("email_on_run", True)),
            },
        )
        if not created:
            sub.email_on_run = bool(request.data.get("email_on_run", sub.email_on_run))
            sub.save(update_fields=["email_on_run", "updated_at"])
        return Response(ReportSubscriptionSerializer(sub).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="share")
    def share(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{user_ids: [1, 2, ...]}`` — add user ids to ``shared_with``."""
        report: Report = self.get_object()  # type: ignore[assignment]
        user_ids = request.data.get("user_ids") or []
        if not isinstance(user_ids, list):
            return Response(
                {"detail": "user_ids must be a list."}, status=status.HTTP_400_BAD_REQUEST
            )
        shared = list(report.shared_with or [])
        for uid in user_ids:
            if uid not in shared:
                shared.append(uid)
        report.shared_with = shared
        report.save(update_fields=["shared_with", "updated_at"])
        return Response(ReportSerializer(report).data)

    @action(detail=True, methods=["post"], url_path="preview")
    def preview(self, request: Request, pk: str | None = None) -> Response:
        """POST a temp config override + execute (does not persist an execution row).

        Body: ``{fields?, filters?, group_by?, aggregates?, order_by?, limit?}``.
        """
        report: Report = self.get_object()  # type: ignore[assignment]
        # Snapshot the report, apply overrides, execute without persisting.
        snapshot_fields = list(report.fields or [])
        snapshot_filters = dict(report.filters or {})
        snapshot_group_by = list(report.group_by or [])
        snapshot_aggregates = list(report.aggregates or [])
        snapshot_order_by = list(report.order_by or [])
        snapshot_limit = report.limit
        try:
            if "fields" in request.data:
                report.fields = request.data["fields"]
            if "filters" in request.data:
                report.filters = request.data["filters"]
            if "group_by" in request.data:
                report.group_by = request.data["group_by"]
            if "aggregates" in request.data:
                report.aggregates = request.data["aggregates"]
            if "order_by" in request.data:
                report.order_by = request.data["order_by"]
            if "limit" in request.data:
                report.limit = int(request.data["limit"])
            result = report_service.execute_report(
                report, user=request.user, persist=False
            )
        finally:
            report.fields = snapshot_fields
            report.filters = snapshot_filters
            report.group_by = snapshot_group_by
            report.aggregates = snapshot_aggregates
            report.order_by = snapshot_order_by
            report.limit = snapshot_limit
        return Response(result)


###############################################################################
# ReportFolderViewSet
###############################################################################


class ReportFolderViewSet(ModelViewSet):
    """CRUD on :class:`ReportFolder`."""

    pagination_class = CRMCursorPagination
    serializer_class = ReportFolderSerializer
    filterset_class = ReportFolderFilter
    queryset = ReportFolder.objects.select_related("tenant", "parent", "created_by")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: ReportFolderSerializer
    ) -> None:
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant, created_by=self.request.user
        )


###############################################################################
# ReportExecutionViewSet
###############################################################################


class ReportExecutionViewSet(ModelViewSet):
    """List / retrieve executions + ``rerun``."""

    pagination_class = CRMCursorPagination
    serializer_class = ReportExecutionSerializer
    filterset_class = ReportExecutionFilter
    queryset = ReportExecution.objects.select_related("tenant", "report", "executed_by")
    http_method_names = ["get", "post", "head", "options"]  # no PUT/PATCH/DELETE

    def get_permissions(self) -> Any:
        if self.action == "rerun":
            return [IsAuthenticated(), IsTenantMember(), HasPermission("reports.manage")]
        return [IsAuthenticated(), IsTenantMember()]

    def perform_create(  # type: ignore[override]
        self, serializer: ReportExecutionSerializer
    ) -> None:
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant, executed_by=self.request.user
        )

    @action(detail=True, methods=["post"], url_path="rerun")
    def rerun(self, request: Request, pk: str | None = None) -> Response:
        """Re-run the report that produced this execution."""
        execution: ReportExecution = self.get_object()  # type: ignore[assignment]
        if execution.report is None:
            return Response(
                {"detail": "Original report has been deleted."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        result = report_service.execute_report(
            execution.report, user=request.user, persist=True
        )
        return Response(result)


# Service class re-exported for callers that prefer a class-style import.
__all__ = [
    "ReportExecutionViewSet",
    "ReportFolderViewSet",
    "ReportService",
    "ReportViewSet",
]
