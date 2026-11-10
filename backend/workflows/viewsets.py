"""DRF ViewSets for the workflows app.

:class:`WorkflowRuleViewSet` — CRUD on :class:`WorkflowRule` plus:
``activate`` / ``deactivate`` / ``duplicate`` / ``test_run`` /
``history`` / ``metrics`` / ``templates`` / ``export_json`` / ``import_json``.

:class:`WorkflowExecutionViewSet` — read-only list / retrieve +
``rerun`` (re-execute a failed run).
"""

from __future__ import annotations

import copy
from typing import Any

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet, ReadOnlyModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember
from workflows.filters import WorkflowExecutionFilter, WorkflowRuleFilter
from workflows.models import WorkflowAction, WorkflowExecution, WorkflowRule
from workflows.serializers import (
    WorkflowExecutionSerializer,
    WorkflowRuleSerializer,
)
from workflows.services import WorkflowService


class WorkflowRuleViewSet(ModelViewSet):
    """CRUD + lifecycle / dry-run / metrics actions for :class:`WorkflowRule`.

    Writes require the ``workflows.manage`` permission. Reads + ``test_run``
    / ``history`` / ``metrics`` / ``templates`` / ``export_json`` are open
    to any tenant member.
    """

    pagination_class = CRMCursorPagination
    serializer_class = WorkflowRuleSerializer
    filterset_class = WorkflowRuleFilter
    queryset = WorkflowRule.objects.select_related("tenant", "created_by")

    def get_permissions(self) -> Any:
        if self.action in (
            "list",
            "retrieve",
            "test_run",
            "history",
            "metrics",
            "templates",
            "export_json",
        ):
            return [IsAuthenticated(), IsTenantMember()]
        return [IsAuthenticated(), IsTenantMember(), HasPermission("workflows.manage")]

    def get_queryset(self) -> Any:
        qs = super().get_queryset()
        params = self.request.query_params
        trigger_type = params.get("trigger_type")
        if trigger_type:
            qs = qs.filter(trigger_type=trigger_type)
        trigger_model = params.get("trigger_model")
        if trigger_model:
            qs = qs.filter(trigger_model=trigger_model)
        is_active = params.get("is_active")
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() in ("true", "1"))
        return qs

    def perform_create(self, serializer: WorkflowRuleSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant, created_by=self.request.user)  # type: ignore[attr-defined]

    # ------------------------------------------------------------------ lifecycle

    @action(detail=True, methods=["post"], url_path="activate")
    def activate(self, request: Request, pk: str | None = None) -> Response:
        rule: WorkflowRule = self.get_object()  # type: ignore[assignment]
        rule.is_active = True
        rule.save(update_fields=["is_active", "updated_at"])
        return Response(self.get_serializer(rule).data)

    @action(detail=True, methods=["post"], url_path="deactivate")
    def deactivate(self, request: Request, pk: str | None = None) -> Response:
        rule: WorkflowRule = self.get_object()  # type: ignore[assignment]
        rule.is_active = False
        rule.save(update_fields=["is_active", "updated_at"])
        return Response(self.get_serializer(rule).data)

    @action(detail=True, methods=["post"], url_path="duplicate")
    def duplicate(self, request: Request, pk: str | None = None) -> Response:
        rule: WorkflowRule = self.get_object()  # type: ignore[assignment]
        new_actions = [
            {
                "order": a.order,
                "action_type": a.action_type,
                "config": copy.deepcopy(a.config or {}),
            }
            for a in rule.actions.order_by("order")
        ]
        clone = WorkflowRule.objects.create(
            tenant=rule.tenant,
            name=f"{rule.name} (copy)",
            trigger_type=rule.trigger_type,
            trigger_model=rule.trigger_model,
            trigger_conditions=copy.deepcopy(rule.trigger_conditions or {}),
            is_active=False,
            version=rule.version,
            created_by=request.user,
        )
        for index, item in enumerate(new_actions):
            WorkflowAction.objects.create(
                tenant=clone.tenant,
                rule=clone,
                order=item.get("order", index),
                action_type=item["action_type"],
                config=item["config"],
            )
        return Response(
            self.get_serializer(clone).data, status=status.HTTP_201_CREATED
        )

    # ------------------------------------------------------------------ dry-run / history / metrics

    @action(detail=True, methods=["post"], url_path="test-run")
    def test_run(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{target_module, target_id}`` → execute the rule synchronously.

        Returns the :class:`WorkflowExecution` row (status + actions log).
        Useful for authoring / debugging a rule before activating it.
        """
        rule: WorkflowRule = self.get_object()  # type: ignore[assignment]
        target_module = request.data.get("target_module") or rule.trigger_model
        target_id = request.data.get("target_id")
        if not target_module or not target_id:
            return Response(
                {"detail": "target_module and target_id are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        execution = WorkflowService().execute_workflow(
            rule_id=rule.pk,
            target_module=str(target_module),
            target_id=str(target_id),
        )
        return Response(WorkflowExecutionSerializer(execution).data)

    @action(detail=True, methods=["get"], url_path="history")
    def history(self, request: Request, pk: str | None = None) -> Response:
        rule: WorkflowRule = self.get_object()  # type: ignore[assignment]
        qs = WorkflowExecution.objects.filter(rule=rule).order_by("-started_at")
        page = self.paginate_queryset(qs)
        serializer = WorkflowExecutionSerializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    @action(detail=True, methods=["get"], url_path="metrics")
    def metrics(self, request: Request, pk: str | None = None) -> Response:
        rule: WorkflowRule = self.get_object()  # type: ignore[assignment]
        return Response(WorkflowService().get_metrics(rule.pk))

    # ------------------------------------------------------------------ templates / import / export

    @action(detail=False, methods=["get"], url_path="templates")
    def templates(self, request: Request) -> Response:
        return Response(WorkflowService().get_templates())

    @action(detail=True, methods=["get"], url_path="export-json")
    def export_json(self, request: Request, pk: str | None = None) -> Response:
        rule: WorkflowRule = self.get_object()  # type: ignore[assignment]
        payload = {
            "name": rule.name,
            "trigger_type": rule.trigger_type,
            "trigger_model": rule.trigger_model,
            "trigger_conditions": rule.trigger_conditions,
            "is_active": rule.is_active,
            "version": rule.version,
            "actions": [
                {
                    "order": a.order,
                    "action_type": a.action_type,
                    "config": a.config,
                }
                for a in rule.actions.order_by("order")
            ],
        }
        return Response(payload)

    @action(detail=False, methods=["post"], url_path="import-json")
    def import_json(self, request: Request) -> Response:
        payload = request.data
        if not isinstance(payload, dict) or "name" not in payload:
            return Response(
                {"detail": "Payload must be a workflow JSON object with 'name'."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        actions_data = payload.get("actions", []) or []
        rule = WorkflowRule.objects.create(
            tenant=request.tenant,  # type: ignore[attr-defined]
            created_by=request.user,
            name=payload["name"],
            trigger_type=payload.get("trigger_type", "manual"),
            trigger_model=payload.get("trigger_model"),
            trigger_conditions=payload.get("trigger_conditions", {}) or {},
            is_active=bool(payload.get("is_active", False)),
            version=int(payload.get("version", 1)),
        )
        for index, item in enumerate(actions_data):
            WorkflowAction.objects.create(
                tenant=rule.tenant,
                rule=rule,
                order=item.get("order", index),
                action_type=item["action_type"],
                config=item.get("config", {}) or {},
            )
        return Response(
            self.get_serializer(rule).data, status=status.HTTP_201_CREATED
        )


class WorkflowExecutionViewSet(ReadOnlyModelViewSet):
    """Read-only list / retrieve for :class:`WorkflowExecution` + ``rerun``."""

    pagination_class = CRMCursorPagination
    serializer_class = WorkflowExecutionSerializer
    filterset_class = WorkflowExecutionFilter
    permission_classes = [IsAuthenticated, IsTenantMember]
    queryset = WorkflowExecution.objects.select_related("rule", "tenant")

    def get_queryset(self) -> Any:
        qs = super().get_queryset()
        params = self.request.query_params
        rule = params.get("rule")
        if rule:
            qs = qs.filter(rule_id=rule)
        rule_status = params.get("status")
        if rule_status:
            qs = qs.filter(status=rule_status)
        return qs

    @action(detail=True, methods=["post"], url_path="rerun")
    def rerun(self, request: Request, pk: str | None = None) -> Response:
        """Re-execute a (typically failed) run with the same target."""
        execution: WorkflowExecution = self.get_object()  # type: ignore[assignment]
        if execution.rule_id is None:
            return Response(
                {"detail": "Original rule has been deleted."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        new_exec = WorkflowService().execute_workflow(
            rule_id=execution.rule_id,
            target_module=execution.target_module,
            target_id=execution.target_id,
        )
        return Response(WorkflowExecutionSerializer(new_exec).data)


__all__ = ["WorkflowExecutionViewSet", "WorkflowRuleViewSet"]
