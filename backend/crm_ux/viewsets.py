"""DRF ViewSets for the CRM UX app.

All viewsets are tenant-scoped (resolved by :class:`api.middleware.TenantMiddleware`)
and require ``IsAuthenticated`` + ``IsTenantMember``.

The seven viewsets:

* :class:`SavedViewSet` — user-persisted list views; ``set_default`` action.
* :class:`RecentlyViewedViewSet` — auto-upserting "last viewed" pointer; ``clear`` action.
* :class:`ActivityViewSet` — read-only activity timeline.
* :class:`NoteViewSet` — notes with @mention / #hashtag parsing on create/update.
* :class:`FileAttachmentViewSet` — file upload → S3 + metadata.
* :class:`RecordLockViewSet` — cooperative 4-hour pessimistic locks; auto-expire on list.
* :class:`TrashViewSet` — virtual viewset aggregating soft-deleted CRM rows;
  ``restore`` + ``purge`` actions.

A convenience :func:`timeline_view` exposes the merged activity+note feed at
``GET /api/v1/timeline/{module}/{record_id}/``.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from django.core.files.storage import default_storage
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from api.permissions import IsTenantMember

from .filters import (
    ActivityFilter,
    FileAttachmentFilter,
    NoteFilter,
    RecordLockFilter,
    RecentlyViewedFilter,
    SavedViewFilter,
)
from .models import (
    Activity,
    FileAttachment,
    Note,
    RecordLock,
    RecentlyViewed,
    SavedView,
)
from .serializers import (
    ActivitySerializer,
    FileAttachmentSerializer,
    NoteSerializer,
    RecordLockSerializer,
    RecentlyViewedSerializer,
    SavedViewSerializer,
    TrashItemSerializer,
)
from .services import (
    get_timeline,
    get_trash_items,
    log_activity,
    purge_from_trash,
    restore_from_trash,
    track_view,
)

log = logging.getLogger(__name__)


###############################################################################
# Shared base
###############################################################################


class _CrmUxBaseViewSet(viewsets.ModelViewSet):
    """Common base: pagination + permission defaults shared across UX viewsets.

    UX list endpoints tend to want a small fixed window (top-20 recents,
    today's timeline, etc.) so we opt out of the global cursor pagination by
    default. Subclasses can re-enable it by setting ``pagination_class``.
    """

    pagination_class = None
    permission_classes = [IsAuthenticated, IsTenantMember]


###############################################################################
# SavedView
###############################################################################


class SavedViewSet(_CrmUxBaseViewSet):
    """User-persisted list configurations per CRM module.

    * ``list`` returns the caller's own views + views shared within the tenant
      (optionally narrowed by ``?module=lead``).
    * Only the owner can ``update`` / ``destroy``; shared views are read-only
      for non-owners.
    * ``POST /saved-views/{id}/set-default/`` marks the view as the caller's
      default for its module (clearing any prior default).
    """

    serializer_class = SavedViewSerializer
    queryset = SavedView.objects.all()
    filterset_class = SavedViewFilter

    def get_queryset(self) -> Any:  # type: ignore[override]
        queryset = super().get_queryset()
        user = self.request.user
        # Caller sees their own views + tenant-shared views.
        return queryset.filter(Q(user=user) | Q(is_shared=True))

    def perform_create(self, serializer: SavedViewSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant, user=self.request.user)  # type: ignore[attr-defined]

    def update(self, request: Request, *args: Any, **kwargs: Any) -> Response:  # type: ignore[override]
        instance = self.get_object()
        if instance.user_id != request.user.pk:
            return Response(
                {"detail": "Only the owner can edit a saved view."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request: Request, *args: Any, **kwargs: Any) -> Response:  # type: ignore[override]
        instance = self.get_object()
        if instance.user_id != request.user.pk:
            return Response(
                {"detail": "Only the owner can delete a saved view."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"], url_path="set-default")
    def set_default(self, request: Request, pk: str | None = None) -> Response:
        """Mark this view as the caller's default for its module.

        Clears any other ``is_default=True`` view the caller owns for the same
        module. Only the owner can set their own default.
        """
        instance = self.get_object()
        if instance.user_id != request.user.pk:
            return Response(
                {"detail": "Only the owner can set a default view."},
                status=status.HTTP_403_FORBIDDEN,
            )
        with transaction.atomic():
            SavedView.objects.filter(
                tenant=request.tenant,  # type: ignore[attr-defined]
                user=request.user,
                module=instance.module,
                is_default=True,
            ).exclude(pk=instance.pk).update(is_default=False)
            instance.is_default = True
            instance.save(update_fields=["is_default", "updated_at"])
        return Response(SavedViewSerializer(instance, context={"request": request}).data)


###############################################################################
# RecentlyViewed
###############################################################################


class RecentlyViewedViewSet(_CrmUxBaseViewSet):
    """Auto-upserting "last viewed" pointers.

    * ``list`` returns the caller's recently-viewed records (optionally
      narrowed by ``?module=lead`` and capped via ``?limit=20``).
    * ``POST`` upserts on (user, module, record_id) — only the latest
      ``viewed_at`` survives.
    * ``POST /recently-viewed/clear/`` wipes all of the caller's rows
      (optionally narrowed by ``?module=lead``).
    """

    serializer_class = RecentlyViewedSerializer
    queryset = RecentlyViewed.objects.all()
    filterset_class = RecentlyViewedFilter

    def get_queryset(self) -> Any:  # type: ignore[override]
        return super().get_queryset().filter(user=self.request.user)

    def list(self, request: Request, *args: Any, **kwargs: Any) -> Response:  # type: ignore[override]
        queryset = self.filter_queryset(self.get_queryset()).order_by("-viewed_at")
        limit = request.query_params.get("limit")
        if limit and limit.isdigit():
            queryset = queryset[: int(limit)]
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)

    def create(self, request: Request, *args: Any, **kwargs: Any) -> Response:  # type: ignore[override]
        module = request.data.get("module")
        record_id = request.data.get("record_id")
        if not module or not record_id:
            return Response(
                {"detail": "module and record_id are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        obj = track_view(
            tenant=request.tenant,  # type: ignore[attr-defined]
            user=request.user,
            module=str(module),
            record_id=str(record_id),
        )
        return Response(
            RecentlyViewedSerializer(obj, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["post"], url_path="clear")
    def clear(self, request: Request) -> Response:
        """Delete all of the caller's RecentlyViewed rows (optionally per module)."""
        module = request.data.get("module") or request.query_params.get("module")
        qs = self.get_queryset()
        if module:
            qs = qs.filter(module=module)
        deleted, _ = qs.delete()
        return Response({"deleted": deleted})


###############################################################################
# Activity (read-only)
###############################################################################


class ActivityViewSet(_CrmUxBaseViewSet):
    """Read-only activity timeline.

    * Filter by ``?module=lead&record_id=123`` for a record timeline.
    * Filter by ``?user=42`` for a specific user's activity (defaults to the
      caller when no record filter and no ``user`` param is supplied).
    """

    serializer_class = ActivitySerializer
    queryset = Activity.objects.all()
    filterset_class = ActivityFilter
    http_method_names = ["get", "head", "options"]

    def get_queryset(self) -> Any:  # type: ignore[override]
        queryset = super().get_queryset().order_by("-created_at")
        return queryset


###############################################################################
# Note
###############################################################################


class NoteViewSet(_CrmUxBaseViewSet):
    """Notes attached to CRM records.

    Mentions and hashtags are parsed from ``body`` on create and update
    (client-supplied values are ignored — see :class:`crm_ux.serializers.NoteSerializer`).
    A ``note_added`` activity is logged on create.
    """

    serializer_class = NoteSerializer
    queryset = Note.objects.all()
    filterset_class = NoteFilter

    def get_queryset(self) -> Any:  # type: ignore[override]
        return super().get_queryset().order_by("-created_at")

    def perform_create(self, serializer: NoteSerializer) -> Note:  # type: ignore[override]
        note = serializer.save(tenant=self.request.tenant, user=self.request.user)  # type: ignore[attr-defined]
        log_activity(
            tenant=self.request.tenant,  # type: ignore[attr-defined]
            user=self.request.user,
            module=note.module,
            record_id=note.record_id,
            record_name=note.body[:60],
            action="note_added",
            description=f"Note added: {(note.body or '')[:80]}",
            metadata={"note_id": note.pk},
        )
        return note

    def update(self, request: Request, *args: Any, **kwargs: Any) -> Response:  # type: ignore[override]
        instance = self.get_object()
        if instance.user_id != request.user.pk:
            return Response(
                {"detail": "Only the author can edit a note."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request: Request, *args: Any, **kwargs: Any) -> Response:  # type: ignore[override]
        instance = self.get_object()
        if instance.user_id != request.user.pk:
            return Response(
                {"detail": "Only the author can delete a note."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().destroy(request, *args, **kwargs)


###############################################################################
# FileAttachment
###############################################################################


class FileAttachmentViewSet(_CrmUxBaseViewSet):
    """File uploads against CRM records.

    ``POST`` accepts a multipart upload (``file``, ``module``, ``record_id``),
    streams the file to default storage (S3 / MinIO), and stores the resulting
    S3 key + URL. A ``file_attached`` activity is logged.
    """

    serializer_class = FileAttachmentSerializer
    queryset = FileAttachment.objects.all()
    filterset_class = FileAttachmentFilter

    def get_queryset(self) -> Any:  # type: ignore[override]
        return super().get_queryset().order_by("-created_at")

    def create(self, request: Request, *args: Any, **kwargs: Any) -> Response:  # type: ignore[override]
        uploaded = request.FILES.get("file")
        module = request.data.get("module")
        record_id = request.data.get("record_id")
        if not uploaded or not module or not record_id:
            return Response(
                {"detail": "file, module, and record_id are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        s3_key = self._build_s3_key(request.tenant, module, record_id, uploaded.name)  # type: ignore[attr-defined]
        file_url = ""
        try:
            saved_name = default_storage.save(s3_key, uploaded)
            file_url = default_storage.url(saved_name)
            s3_key = saved_name
        except Exception:  # pragma: no cover — depends on storage backend
            log.exception("FileAttachmentViewSet.create: storage save failed for %s", s3_key)

        attachment = FileAttachment.objects.create(
            tenant=request.tenant,  # type: ignore[attr-defined]
            user=request.user,
            module=str(module),
            record_id=str(record_id),
            filename=uploaded.name,
            file_url=file_url,
            file_size=uploaded.size or 0,
            mime_type=uploaded.content_type or "",
            s3_key=s3_key,
        )
        log_activity(
            tenant=request.tenant,  # type: ignore[attr-defined]
            user=request.user,
            module=str(module),
            record_id=str(record_id),
            record_name=uploaded.name,
            action="file_attached",
            description=f"Attached file '{uploaded.name}' ({uploaded.size or 0} bytes).",
            metadata={"attachment_id": attachment.pk, "mime_type": attachment.mime_type},
        )
        return Response(
            FileAttachmentSerializer(attachment, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    def destroy(self, request: Request, *args: Any, **kwargs: Any) -> Response:  # type: ignore[override]
        instance = self.get_object()
        # Best-effort storage delete; the DB row goes away regardless.
        if instance.s3_key:
            try:
                default_storage.delete(instance.s3_key)
            except Exception:  # pragma: no cover — depends on storage backend
                log.exception("FileAttachmentViewSet.destroy: storage delete failed for %s", instance.s3_key)
        return super().destroy(request, *args, **kwargs)

    @staticmethod
    def _build_s3_key(tenant: Any, module: str, record_id: str, filename: str) -> str:
        """Compute an S3 key for an upload.

        ``crm_ux/{tenant_id}/{module}/{record_id}/{uuid}_{filename}`` — the
        UUID prevents collisions when the same record gets multiple files
        with the same name.
        """
        safe_name = (filename or "file").replace("/", "_")
        return f"crm_ux/{tenant.pk}/{module}/{record_id}/{uuid.uuid4().hex}_{safe_name}"


###############################################################################
# RecordLock
###############################################################################


class RecordLockViewSet(_CrmUxBaseViewSet):
    """Cooperative pessimistic record locks.

    * ``list`` purges expired locks first, then returns the (module, record_id)
      filter results.
    * ``POST`` creates or refreshes a lock for the caller. If a non-expired
      lock exists for another user, returns 409.
    * ``DELETE`` unlocks — only the lock owner can unlock (admin override is
      out of scope here).
    """

    serializer_class = RecordLockSerializer
    queryset = RecordLock.objects.all()
    filterset_class = RecordLockFilter

    def get_queryset(self) -> Any:  # type: ignore[override]
        return super().get_queryset().order_by("-locked_at")

    def list(self, request: Request, *args: Any, **kwargs: Any) -> Response:  # type: ignore[override]
        self._purge_expired()
        return super().list(request, *args, **kwargs)

    def create(self, request: Request, *args: Any, **kwargs: Any) -> Response:  # type: ignore[override]
        module = request.data.get("module")
        record_id = request.data.get("record_id")
        if not module or not record_id:
            return Response(
                {"detail": "module and record_id are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        self._purge_expired()
        existing = (
            self.get_queryset()
            .filter(module=module, record_id=str(record_id))
            .select_related("user")
            .first()
        )
        if existing is not None and existing.user_id != request.user.pk:
            return Response(
                {
                    "detail": "Record is locked by another user.",
                    "locked_by": existing.user_id,
                    "expires_at": existing.expires_at.isoformat(),
                },
                status=status.HTTP_409_CONFLICT,
            )
        # The model's save() hook fills in expires_at when blank.
        lock, _created = RecordLock.objects.update_or_create(
            tenant=request.tenant,  # type: ignore[attr-defined]
            module=str(module),
            record_id=str(record_id),
            defaults={
                "user": request.user,
                "locked_at": timezone.now(),
                "expires_at": None,
            },
        )
        # update_or_create with expires_at=None triggered save(), which set
        # expires_at = locked_at + TTL. Re-fetch is unnecessary — `lock` is
        # already up to date because save() mutates in place.
        return Response(
            RecordLockSerializer(lock, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    def destroy(self, request: Request, *args: Any, **kwargs: Any) -> Response:  # type: ignore[override]
        instance = self.get_object()
        if instance.user_id != request.user.pk:
            return Response(
                {"detail": "Only the lock owner can unlock."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().destroy(request, *args, **kwargs)

    @staticmethod
    def _purge_expired() -> int:
        """Delete all expired locks. Returns the count purged."""
        deleted, _ = RecordLock.objects.filter(expires_at__lt=timezone.now()).delete()
        return deleted


###############################################################################
# Trash (virtual viewset — aggregates soft-deleted CRM rows)
###############################################################################


class TrashViewSet(viewsets.GenericViewSet):
    """Virtual viewset aggregating soft-deleted CRM rows across modules.

    * ``GET /trash/`` lists soft-deleted records (optionally ``?module=lead``).
    * ``POST /trash/restore/`` body ``{"module": "lead", "record_id": "123"}``
      restores the record (clears ``deleted_at``).
    * ``POST /trash/purge/`` body ``{"module": "lead", "record_id": "123"}``
      permanently deletes the record.
    """

    permission_classes = [IsAuthenticated, IsTenantMember]
    pagination_class = None
    serializer_class = TrashItemSerializer

    def get_queryset(self) -> list[dict[str, Any]]:  # type: ignore[override]
        module = self.request.query_params.get("module")  # type: ignore[union-attr]
        return get_trash_items(tenant=self.request.tenant, module=module)  # type: ignore[attr-defined]

    def list(self, request: Request, *args: Any, **kwargs: Any) -> Response:  # type: ignore[override]
        items = self.get_queryset()
        serializer = self.get_serializer(items, many=True)
        return Response({"count": len(items), "results": serializer.data})

    @action(detail=False, methods=["post"], url_path="restore")
    def restore(self, request: Request) -> Response:
        """Restore a soft-deleted CRM record."""
        module = request.data.get("module")
        record_id = request.data.get("record_id")
        if not module or not record_id:
            return Response(
                {"detail": "module and record_id are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            record = restore_from_trash(
                tenant=request.tenant,  # type: ignore[attr-defined]
                module=str(module),
                record_id=str(record_id),
            )
        except Exception as exc:  # noqa: BLE001 — translate to 404
            return Response(
                {"detail": f"Could not restore: {exc}"},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(
            {"restored": True, "module": module, "record_id": record.pk},
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=["post"], url_path="purge")
    def purge(self, request: Request) -> Response:
        """Permanently delete a soft-deleted CRM record."""
        module = request.data.get("module")
        record_id = request.data.get("record_id")
        if not module or not record_id:
            return Response(
                {"detail": "module and record_id are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            purge_from_trash(
                tenant=request.tenant,  # type: ignore[attr-defined]
                module=str(module),
                record_id=str(record_id),
            )
        except Exception as exc:  # noqa: BLE001 — translate to 404
            return Response(
                {"detail": f"Could not purge: {exc}"},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(
            {"purged": True, "module": module, "record_id": record_id},
            status=status.HTTP_200_OK,
        )


###############################################################################
# Convenience: timeline endpoint (function-based view)
###############################################################################


@api_view(["GET"])
@permission_classes([IsAuthenticated, IsTenantMember])
def timeline_view(request: Request, module: str, record_id: str) -> Response:
    """GET ``/api/v1/timeline/{module}/{record_id}/`` — merged activity + note feed.

    Returns ``{"Today": [...], "Yesterday": [...], "This Week": [...], "Earlier": [...]}``.
    """
    tenant = getattr(request, "tenant", None)
    if tenant is None:
        return Response({"detail": "Tenant required."}, status=status.HTTP_400_BAD_REQUEST)
    buckets = get_timeline(tenant=tenant, module=module, record_id=record_id)
    return Response(buckets)
