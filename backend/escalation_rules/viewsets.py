"""DRF ViewSets for the escalation_rules app.

:class:`EscalationRuleViewSet` — CRUD on :class:`EscalationRule` plus a
``dry_run`` action that returns the records the rule would escalate
without actually escalating them.

:class:`EscalationLogViewSet` — read-only list / retrieve on
:class:`EscalationLog`.
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
from escalation_rules.filters import (
    EscalationLogFilter,
    EscalationRuleFilter,
)
from escalation_rules.models import EscalationLog, EscalationRule
from escalation_rules.serializers import (
    EscalationLogSerializer,
    EscalationRuleSerializer,
)
from escalation_rules.services import EscalationService


class EscalationRuleViewSet(ModelViewSet):
    """CRUD + ``dry_run`` action for :class:`EscalationRule`.

    Writes (create / update / destroy) require the
    ``escalation_rules.manage`` permission. Reads + ``dry_run`` are open
    to any tenant member.
    """

    pagination_class = CRMCursorPagination
    serializer_class = EscalationRuleSerializer
    filterset_class = EscalationRuleFilter
    queryset = EscalationRule.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        if self.action in ("list", "retrieve", "dry_run"):
            return [IsAuthenticated(), IsTenantMember()]
        return [IsAuthenticated(), IsTenantMember(), HasPermission("escalation_rules.manage")]

    def get_queryset(self) -> Any:
        qs = super().get_queryset()
        target_model = self.request.query_params.get("target_model")
        if target_model:
            qs = qs.filter(target_model=target_model)
        action_param = self.request.query_params.get("action")
        if action_param:
            qs = qs.filter(action=action_param)
        is_active = self.request.query_params.get("is_active")
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() in ("true", "1"))
        return qs

    def perform_create(self, serializer: EscalationRuleSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    # ------------------------------------------------------------------ actions

    @action(detail=True, methods=["get"], url_path="dry-run")
    def dry_run(self, request: Request, pk: str | None = None) -> Response:
        """GET — list the records this rule would escalate without escalating them.

        Returns ``{"count": int, "results": [{record_id, ...}]}`` (limited
        to 200 records).
        """
        rule: EscalationRule = self.get_object()  # type: ignore[assignment]
        service = EscalationService()
        model_cls = service._resolve_model(rule.target_model)  # noqa: SLF001
        if model_cls is None:
            return Response({"count": 0, "results": []})
        from datetime import timedelta

        from django.utils import timezone

        cutoff = timezone.now() - timedelta(hours=rule.time_limit_hours)
        qs = model_cls.objects.filter(created_at__lt=cutoff)
        out: list[dict[str, Any]] = []
        for record in qs.iterator(chunk_size=200):
            record_data = service._record_to_dict(record)  # noqa: SLF001
            if not service.evaluate_criteria(record_data, rule.criteria):
                continue
            out.append(
                {
                    "record_id": record.pk,
                    "name": str(getattr(record, "name", "") or record.pk),
                    "created_at": record.created_at.isoformat(),
                }
            )
            if len(out) >= 200:
                break
        return Response({"count": len(out), "results": out})


class EscalationLogViewSet(ReadOnlyModelViewSet):
    """Read-only list / retrieve for :class:`EscalationLog`."""

    pagination_class = CRMCursorPagination
    serializer_class = EscalationLogSerializer
    filterset_class = EscalationLogFilter
    permission_classes = [IsAuthenticated, IsTenantMember]
    queryset = EscalationLog.objects.select_related(
        "rule", "escalated_to", "tenant"
    )

    def get_queryset(self) -> Any:
        qs = super().get_queryset()
        record_module = self.request.query_params.get("record_module")
        if record_module:
            qs = qs.filter(record_module=record_module)
        record_id = self.request.query_params.get("record_id")
        if record_id:
            qs = qs.filter(record_id=record_id)
        escalated_to = self.request.query_params.get("escalated_to")
        if escalated_to:
            qs = qs.filter(escalated_to_id=escalated_to)
        action_taken = self.request.query_params.get("action_taken")
        if action_taken:
            qs = qs.filter(action_taken=action_taken)
        return qs


__all__ = ["EscalationLogViewSet", "EscalationRuleViewSet"]
