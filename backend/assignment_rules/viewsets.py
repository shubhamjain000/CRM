"""DRF ViewSets for the assignment_rules app.

:class:`AssignmentRuleViewSet` — CRUD on :class:`AssignmentRule` plus an
``evaluate`` action that dry-runs the rule against a sample record dict
and returns the resolved user id.

:class:`AssignmentHistoryViewSet` — read-only list / retrieve on
:class:`AssignmentHistory`.
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
from assignment_rules.filters import (
    AssignmentHistoryFilter,
    AssignmentRuleFilter,
)
from assignment_rules.models import AssignmentHistory, AssignmentRule
from assignment_rules.serializers import (
    AssignmentHistorySerializer,
    AssignmentRuleSerializer,
)
from assignment_rules.services import AssignmentService


class AssignmentRuleViewSet(ModelViewSet):
    """CRUD + ``evaluate`` action for :class:`AssignmentRule`.

    Writes (create / update / destroy) require the
    ``assignment_rules.manage`` permission. Reads + ``evaluate`` are open
    to any tenant member.
    """

    pagination_class = CRMCursorPagination
    serializer_class = AssignmentRuleSerializer
    filterset_class = AssignmentRuleFilter
    queryset = AssignmentRule.objects.select_related(
        "tenant", "fallback_user"
    ).prefetch_related("assignments")

    def get_permissions(self) -> Any:
        if self.action in ("list", "retrieve", "evaluate"):
            return [IsAuthenticated(), IsTenantMember()]
        return [IsAuthenticated(), IsTenantMember(), HasPermission("assignment_rules.manage")]

    def get_queryset(self) -> Any:
        qs = super().get_queryset()
        target_model = self.request.query_params.get("target_model")
        if target_model:
            qs = qs.filter(target_model=target_model)
        strategy = self.request.query_params.get("strategy")
        if strategy:
            qs = qs.filter(strategy=strategy)
        is_active = self.request.query_params.get("is_active")
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() in ("true", "1"))
        return qs

    def perform_create(self, serializer: AssignmentRuleSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    # ------------------------------------------------------------------ actions

    @action(detail=False, methods=["post"], url_path="evaluate")
    def evaluate(self, request: Request) -> Response:
        """POST ``{"target_model": "lead", "record": {...}}`` → ``{"user_id": <id>, "rule_id": <id>}``.

        Dry-run the rule set against the supplied record dict. Returns
        ``{"user_id": null, "rule_id": null}`` when no rule matches.
        """
        target_model = request.data.get("target_model")
        record = request.data.get("record") or {}
        if not target_model:
            return Response(
                {"detail": "target_model is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not isinstance(record, dict):
            return Response(
                {"detail": "record must be a JSON object."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        service = AssignmentService()
        rule, user = service.evaluate_rules(target_model, record)
        return Response(
            {
                "rule_id": rule.pk if rule else None,
                "user_id": user.pk if user else None,
                "user_name": (
                    getattr(user, "name", "") or getattr(user, "email", "")
                    if user
                    else ""
                ),
            }
        )


class AssignmentHistoryViewSet(ReadOnlyModelViewSet):
    """Read-only list / retrieve for :class:`AssignmentHistory`."""

    pagination_class = CRMCursorPagination
    serializer_class = AssignmentHistorySerializer
    filterset_class = AssignmentHistoryFilter
    permission_classes = [IsAuthenticated, IsTenantMember]
    queryset = AssignmentHistory.objects.select_related(
        "rule", "assigned_to", "tenant"
    )

    def get_queryset(self) -> Any:
        qs = super().get_queryset()
        record_module = self.request.query_params.get("record_module")
        if record_module:
            qs = qs.filter(record_module=record_module)
        record_id = self.request.query_params.get("record_id")
        if record_id:
            qs = qs.filter(record_id=record_id)
        assigned_to = self.request.query_params.get("assigned_to")
        if assigned_to:
            qs = qs.filter(assigned_to_id=assigned_to)
        return qs


__all__ = ["AssignmentHistoryViewSet", "AssignmentRuleViewSet"]
