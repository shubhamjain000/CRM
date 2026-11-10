"""DRF ViewSets for the backup app.

* :class:`BackupRecordViewSet` — read-only list / retrieve +
  ``restore`` stub action (gated by ``backup.manage``). The real
  restore dispatch would enqueue a Celery task that downloads the
  object at ``s3_key`` and writes it back to the tenant's database /
  object store; here we simply acknowledge the request.
"""

from __future__ import annotations

from typing import Any

from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ReadOnlyModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember

from .models import BackupRecord
from .serializers import BackupRecordSerializer


class BackupRecordViewSet(ReadOnlyModelViewSet):
    """Read-only :class:`BackupRecord` + ``restore`` stub action."""

    pagination_class = CRMCursorPagination
    serializer_class = BackupRecordSerializer
    queryset = BackupRecord.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        if self.action == "restore":
            return [
                IsAuthenticated(),
                IsTenantMember(),
                HasPermission("backup.manage"),
            ]
        return [IsAuthenticated(), IsTenantMember()]

    @action(detail=True, methods=["post"], url_path="restore")
    def restore(self, request: Request, pk: str | None = None) -> Response:
        """POST — schedule a restore from this backup (stub).

        Returns ``{"status": "scheduled", "backup_id": ..., "s3_key": ...,
        "message": "Restore job queued (stub)."}``.
        """
        backup: BackupRecord = self.get_object()  # type: ignore[assignment]
        return Response(
            {
                "status": "scheduled",
                "backup_id": backup.pk,
                "s3_key": backup.s3_key,
                "message": "Restore job queued (stub).",
            }
        )


__all__ = ["BackupRecordViewSet"]
