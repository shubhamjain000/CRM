"""DRF ViewSets for the compliance app.

* :class:`ComplianceFrameworkViewSet` — CRUD on the global framework
  catalog (read open to any tenant member; writes require
  ``compliance.manage``).
* :class:`ComplianceChecklistViewSet` — CRUD + ``report`` action that
  rolls up per-framework status counts + compliance percentage.
* :class:`DataProcessingConsentViewSet` — CRUD on the consent registry.
"""

from __future__ import annotations

from collections import Counter
from typing import Any

from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember

from .models import ComplianceChecklist, ComplianceFramework, DataProcessingConsent
from .serializers import (
    ComplianceChecklistSerializer,
    ComplianceFrameworkSerializer,
    DataProcessingConsentSerializer,
)


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve", "report"):
        return [IsAuthenticated(), IsTenantMember()]
    return [
        IsAuthenticated(),
        IsTenantMember(),
        HasPermission("compliance.manage"),
    ]


class ComplianceFrameworkViewSet(ModelViewSet):
    """CRUD on :class:`ComplianceFramework` (global catalog)."""

    pagination_class = CRMCursorPagination
    serializer_class = ComplianceFrameworkSerializer
    queryset = ComplianceFramework.objects.all()
    permission_classes = [IsAuthenticated, IsTenantMember]


class ComplianceChecklistViewSet(ModelViewSet):
    """CRUD on :class:`ComplianceChecklist` + ``report`` aggregation."""

    pagination_class = CRMCursorPagination
    serializer_class = ComplianceChecklistSerializer
    queryset = ComplianceChecklist.objects.select_related("tenant", "framework")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: ComplianceChecklistSerializer
    ) -> None:
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    @action(detail=False, methods=["get"], url_path="report")
    def report(self, request: Request) -> Response:
        """GET — per-framework compliance roll-up for the active tenant.

        Returns a list of ``{framework_id, framework, total, met,
        status_counts, compliance_pct}`` rows. ``compliance_pct`` is
        ``met / total * 100`` rounded to 2 dp.
        """
        qs = self.get_queryset()
        rows = list(qs.values("framework_id", "framework__name", "status"))
        by_fw: dict[int, dict[str, Any]] = {}
        for row in rows:
            fw_id = row["framework_id"]
            fw_name = row["framework__name"]
            bucket = by_fw.setdefault(
                fw_id,
                {
                    "framework_id": fw_id,
                    "framework": fw_name,
                    "status_counts": Counter(),
                },
            )
            bucket["status_counts"][row["status"]] += 1
        out: list[dict[str, Any]] = []
        for bucket in by_fw.values():
            counts = dict(bucket["status_counts"])
            total = sum(counts.values())
            met = counts.get("met", 0)
            out.append(
                {
                    "framework_id": bucket["framework_id"],
                    "framework": bucket["framework"],
                    "total": total,
                    "met": met,
                    "status_counts": counts,
                    "compliance_pct": round((met / total * 100) if total else 0.0, 2),
                }
            )
        return Response(out)


class DataProcessingConsentViewSet(ModelViewSet):
    """CRUD on :class:`DataProcessingConsent`."""

    pagination_class = CRMCursorPagination
    serializer_class = DataProcessingConsentSerializer
    queryset = DataProcessingConsent.objects.select_related("tenant", "user")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: DataProcessingConsentSerializer
    ) -> None:
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


__all__ = [
    "ComplianceFrameworkViewSet",
    "ComplianceChecklistViewSet",
    "DataProcessingConsentViewSet",
]
