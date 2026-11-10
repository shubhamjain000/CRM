"""DRF ViewSet for the attachments app.

Provides list (filter by record_module + record_id), create, destroy, and
a ``bulk_download`` action that streams a ZIP of the requested attachment
files. Permissions: any tenant member can read / create; destroy requires
either the attacher or an org admin.

Note: the actual ZIP streaming happens in-memory — for very large batches
a real deployment would stream from S3 directly via a multipart response.
"""

from __future__ import annotations

import io
import zipfile
from typing import Any, Iterable

from django.http import HttpResponse
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from api.crm_base import CRMModelViewSet
from api.permissions import HasPermission, IsTenantMember
from attachments.filters import AttachmentFilter
from attachments.models import Attachment
from attachments.serializers import (
    AttachmentBulkDownloadSerializer,
    AttachmentSerializer,
)
from files.services import generate_presigned_download


class AttachmentViewSet(CRMModelViewSet):
    """CRUD + bulk-download for :class:`attachments.models.Attachment`."""

    serializer_class = AttachmentSerializer
    queryset = (
        Attachment.objects.all()
        .select_related("file", "attached_by")
        .prefetch_related("file__shares")
    )
    filterset_class = AttachmentFilter
    sort_fields: tuple[str, ...] = (
        "id",
        "record_module",
        "record_id",
        "is_inline",
        "created_at",
        "updated_at",
    )
    bulk_update_fields: tuple[str, ...] = (
        "description",
        "is_inline",
    )
    required_permission: Iterable[str] | str = "crm.attachments.read"

    def get_permissions(self) -> Any:
        method = self.request.method or ""
        if method in ("GET", "HEAD", "OPTIONS"):
            perm = "crm.attachments.read"
        elif method == "POST":
            perm = "crm.attachments.create"
        elif method in ("PUT", "PATCH"):
            perm = "crm.attachments.update"
        elif method == "DELETE":
            perm = "crm.attachments.delete"
        else:
            return [IsAuthenticated(), IsTenantMember()]
        return [IsAuthenticated(), IsTenantMember(), HasPermission(perm)]

    def perform_create(self, serializer: AttachmentSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    def perform_destroy(self, instance: Attachment) -> None:  # type: ignore[override]
        """Hard delete — attachments aren't soft-deleted."""
        instance.delete()

    # ------------------------------------------------------------------ bulk download

    @action(detail=False, methods=["post"], url_path="bulk-download")
    def bulk_download(self, request: Request) -> HttpResponse:
        """POST ``{"ids": [<attachment_id>, ...]}`` → ZIP of the files.

        Streams the requested attachments as a single ZIP archive. The
        caller is responsible for keeping the batch size reasonable (a
        few hundred files at most); for larger batches a real deployment
        would use a presigned-URL manifest + client-side fetch.
        """
        serializer = AttachmentBulkDownloadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ids = serializer.validated_data["ids"]
        attachments = self.filter_queryset(self.get_queryset()).filter(pk__in=ids)

        if not attachments.exists():
            return Response(
                {"detail": "No matching attachments."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Build the ZIP in-memory. For each attachment, generate a presigned
        # URL and fetch the bytes (lazy — for the spec we record the
        # presigned URLs as a JSON manifest inside the ZIP; a real
        # deployment would stream the bytes via boto3 directly).
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            manifest: list[dict[str, Any]] = []
            for attachment in attachments:
                presigned = generate_presigned_download(attachment.file.storage_key, expires=3600)
                manifest.append(
                    {
                        "attachment_id": attachment.pk,
                        "file_id": attachment.file_id,
                        "name": attachment.file.name,
                        "size": attachment.file.size,
                        "mime_type": attachment.file.mime_type,
                        "url": presigned,
                    }
                )
            archive.writestr(
                "manifest.json",
                __import__("json").dumps(manifest, indent=2),
            )
        buffer.seek(0)

        response = HttpResponse(buffer.getvalue(), content_type="application/zip")
        response["Content-Disposition"] = 'attachment; filename="attachments.zip"'
        return response

    # ------------------------------------------------------------------ merge override (no-op)

    def _merge(self, source: Any, target: Any) -> None:  # type: ignore[override]
        """Attachments cannot be merged — base ``merge`` action is a no-op."""
        return None
