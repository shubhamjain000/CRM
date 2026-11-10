"""DRF ViewSets for the validation_rules app.

:class:`ValidationRuleViewSet` — CRUD on :class:`ValidationRule` plus two
introspection actions:

* ``test`` (POST) — submit a sample record dict + target model and
  receive the list of violations the rule set would produce.
* ``bulk_check`` (GET) — iterate every existing record of the target
  model and receive the violations across the whole tenant.
"""

from __future__ import annotations

from typing import Any

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember
from validation_rules.filters import ValidationRuleFilter
from validation_rules.models import ValidationRule
from validation_rules.serializers import (
    ValidationRuleSerializer,
    ValidationViolationSerializer,
)
from validation_rules.services import ValidationService


class ValidationRuleViewSet(ModelViewSet):
    """CRUD + ``test`` / ``bulk_check`` actions for :class:`ValidationRule`.

    Writes (create / update / destroy) require the ``validation_rules.manage``
    permission. Reads + the introspection actions are open to any tenant
    member.
    """

    pagination_class = CRMCursorPagination
    serializer_class = ValidationRuleSerializer
    filterset_class = ValidationRuleFilter
    queryset = ValidationRule.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        if self.action in ("list", "retrieve", "test", "bulk_check"):
            return [IsAuthenticated(), IsTenantMember()]
        return [IsAuthenticated(), IsTenantMember(), HasPermission("validation_rules.manage")]

    def get_queryset(self) -> Any:
        qs = super().get_queryset()
        target_model = self.request.query_params.get("target_model")
        if target_model:
            qs = qs.filter(target_model=target_model)
        field_name = self.request.query_params.get("field_name")
        if field_name:
            qs = qs.filter(field_name__iexact=field_name)
        is_active = self.request.query_params.get("is_active")
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() in ("true", "1"))
        return qs

    def perform_create(self, serializer: ValidationRuleSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    # ------------------------------------------------------------------ actions

    @action(detail=False, methods=["post"], url_path="test")
    def test(self, request: Request) -> Response:
        """POST ``{"target_model": "deal", "record": {...}, "trigger": "create"}``.

        Returns ``{"violations": [...]}`` — the list of rules the record
        would fail. ``trigger`` is optional (defaults to ``both``).
        """
        target_model = request.data.get("target_model")
        record = request.data.get("record") or {}
        trigger = request.data.get("trigger") or "both"
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
        service = ValidationService()
        violations = service.validate_record(target_model, record, trigger=trigger)
        serializer = ValidationViolationSerializer(violations, many=True)
        return Response({"violations": serializer.data})

    @action(detail=False, methods=["get"], url_path="bulk-check")
    def bulk_check(self, request: Request) -> Response:
        """GET ``?target_model=deal`` — violations across every existing record."""
        target_model = request.query_params.get("target_model")
        if not target_model:
            return Response(
                {"detail": "target_model query param is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        service = ValidationService()
        violations = service.bulk_check(target_model)
        serializer = ValidationViolationSerializer(violations, many=True)
        return Response(
            {
                "target_model": target_model,
                "checked": _record_count(target_model),
                "violations": serializer.data,
            }
        )


def _record_count(target_model: str) -> int:
    """Return the number of records of ``target_model`` in the tenant."""
    from validation_rules.services import ValidationService

    model_cls = ValidationService._resolve_model(target_model)
    if model_cls is None:
        return 0
    return model_cls.objects.count()


__all__ = ["ValidationRuleViewSet"]
