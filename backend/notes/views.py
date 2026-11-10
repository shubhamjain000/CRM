"""DRF ViewSet for the notes app.

Provides CRUD + collaboration actions: ``pin``, ``share``, ``comment``,
``resolve_comment``, ``restore_version``, ``version_history``,
``save_snapshot``. Cursor pagination, sort whitelist, and tenant scoping
come from the shared :class:`api.crm_base.CRMModelViewSet`.

Permissions
-----------
* Reads — author, anyone in ``shared_with`` (or any tenant member for
  non-private notes), and org admins.
* Writes — author or holders of ``edit`` / ``admin`` permission via
  :class:`NoteShare`.
"""

from __future__ import annotations

from typing import Any, Iterable

from django.db import transaction
from django.db.models import Model, Q
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from api.crm_base import CRMModelViewSet
from api.models import User
from api.permissions import HasPermission, IsTenantMember
from notes.filters import NoteFilter
from notes.models import Note, NoteComment, NoteShare, NoteVersion
from notes.serializers import (
    NoteCommentCreateSerializer,
    NoteCommentSerializer,
    NoteRestoreVersionSerializer,
    NoteSerializer,
    NoteShareCreateSerializer,
    NoteShareSerializer,
    NoteVersionSerializer,
)


class NoteViewSet(CRMModelViewSet):
    """CRUD + collaboration actions for :class:`notes.models.Note`."""

    serializer_class = NoteSerializer
    queryset = (
        Note.objects.all()
        .select_related("author", "last_edited_by")
        .prefetch_related("shares__user", "comments__user", "versions")
    )
    filterset_class = NoteFilter
    sort_fields: tuple[str, ...] = (
        "id",
        "title",
        "is_pinned",
        "is_private",
        "created_at",
        "updated_at",
    )
    bulk_update_fields: tuple[str, ...] = (
        "title",
        "is_pinned",
        "is_private",
        "body_type",
        "related_module",
        "related_id",
    )
    required_permission: Iterable[str] | str = "crm.notes.read"

    def get_permissions(self) -> Any:
        method = self.request.method or ""
        if method in ("GET", "HEAD", "OPTIONS"):
            perm = "crm.notes.read"
        elif method == "POST":
            perm = "crm.notes.create"
        elif method in ("PUT", "PATCH"):
            perm = "crm.notes.update"
        elif method == "DELETE":
            perm = "crm.notes.delete"
        else:
            return [IsAuthenticated(), IsTenantMember()]
        return [IsAuthenticated(), IsTenantMember(), HasPermission(perm)]

    def get_queryset(self) -> Any:
        """Scope to notes the caller can read.

        * Private notes — only visible to their author.
        * Shared notes — visible to author + users in ``shared_with``.
        * Public notes (default) — visible to every tenant member.
        """
        queryset = super().get_queryset()
        user: User = self.request.user  # type: ignore[union-attr]
        # Private notes: only author. Shared: author OR in shared_with.
        # Public (is_private=False, no share needed): everyone in tenant.
        return queryset.filter(
            Q(author=user)
            | Q(is_private=False)
            | Q(shares__user=user)
        ).distinct()

    def perform_create(self, serializer: NoteSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    # ------------------------------------------------------------------ object perms

    def _user_can_write(self, note: Note) -> bool:
        user: User = self.request.user  # type: ignore[union-attr]
        if note.author_id == user.pk:
            return True
        share = NoteShare.objects.filter(note=note, user=user).first()
        if share is None:
            return False
        return share.permission in (NoteShare.PERMISSION_EDIT, NoteShare.PERMISSION_ADMIN)

    def _user_can_admin(self, note: Note) -> bool:
        user: User = self.request.user  # type: ignore[union-attr]
        if note.author_id == user.pk:
            return True
        share = NoteShare.objects.filter(note=note, user=user).first()
        if share is None:
            return False
        return share.permission == NoteShare.PERMISSION_ADMIN

    def perform_update(self, serializer: NoteSerializer) -> None:  # type: ignore[override]
        note: Note = serializer.instance  # type: ignore[attr-defined]
        if not self._user_can_write(note):
            self.permission_denied(
                self.request,
                message="You do not have edit permission on this note.",
            )
        serializer.save(last_edited_by=self.request.user)

    def perform_destroy(self, instance: Note) -> None:  # type: ignore[override]
        if not self._user_can_admin(instance):
            self.permission_denied(
                self.request,
                message="Only the author or an admin share can delete this note.",
            )
        super().perform_destroy(instance)

    # ------------------------------------------------------------------ pin / unpin

    @action(detail=True, methods=["post"], url_path="pin")
    def pin(self, request: Request, pk: str | None = None) -> Response:
        """Toggle the ``is_pinned`` flag on a note."""
        note: Note = self.get_object()
        if not self._user_can_write(note):
            self.permission_denied(
                request, message="You do not have edit permission on this note."
            )
        note.is_pinned = not note.is_pinned
        note.save(update_fields=["is_pinned", "updated_at"])
        return Response(NoteSerializer(note, context={"request": request}).data)

    # ------------------------------------------------------------------ share

    @action(detail=True, methods=["post", "delete"], url_path="share")
    def share(self, request: Request, pk: str | None = None) -> Response:
        """POST to grant a share, DELETE to revoke one.

        Body: ``{"user_id": <id>, "permission": "read|edit|admin"}``.
        """
        note: Note = self.get_object()
        if not self._user_can_admin(note):
            self.permission_denied(
                request, message="Only the author or an admin share can manage shares."
            )
        if request.method == "DELETE":
            user_id = request.data.get("user_id")
            if not user_id:
                return Response(
                    {"detail": "user_id is required."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            deleted, _ = NoteShare.objects.filter(note=note, user_id=user_id).delete()
            return Response({"deleted": deleted})

        serializer = NoteShareCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            share, created = NoteShare.objects.update_or_create(
                note=note,
                user=serializer.validated_data["user"],
                defaults={"permission": serializer.validated_data["permission"]},
            )
        return Response(
            NoteShareSerializer(share, context={"request": request}).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    # ------------------------------------------------------------------ comments

    @action(detail=True, methods=["post"], url_path="comment")
    def comment(self, request: Request, pk: str | None = None) -> Response:
        """Add a comment (optionally anchored to ``selected_text``)."""
        note: Note = self.get_object()
        serializer = NoteCommentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        comment = NoteComment.objects.create(
            note=note,
            user=request.user,
            body=serializer.validated_data["body"],
            selected_text=serializer.validated_data.get("selected_text", ""),
        )
        return Response(
            NoteCommentSerializer(comment, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(
        detail=True,
        methods=["post"],
        url_path=r"comments/(?P<comment_id>\d+)/resolve",
    )
    def resolve_comment(self, request: Request, pk: str | None = None, comment_id: int | None = None) -> Response:
        """Toggle the ``resolved`` flag on a comment."""
        note: Note = self.get_object()
        comment = get_object_or_404(NoteComment, pk=comment_id, note=note)
        comment.resolved = not comment.resolved
        comment.save(update_fields=["resolved", "updated_at"])
        return Response(NoteCommentSerializer(comment, context={"request": request}).data)

    # ------------------------------------------------------------------ versions

    @action(detail=True, methods=["get"], url_path="version-history")
    def version_history(self, request: Request, pk: str | None = None) -> Response:
        """Return all :class:`NoteVersion` snapshots, newest first."""
        note: Note = self.get_object()
        versions = note.versions.order_by("-version_number")
        return Response(
            {
                "count": versions.count(),
                "results": NoteVersionSerializer(
                    versions, many=True, context={"request": request}
                ).data,
            }
        )

    @action(detail=True, methods=["post"], url_path="restore-version")
    def restore_version(self, request: Request, pk: str | None = None) -> Response:
        """Restore the note body to a previous version.

        Body: ``{"version_number": <int>}``. Creates a *new* version capturing
        the current body before restoring, so the restore itself is reversible.
        """
        note: Note = self.get_object()
        if not self._user_can_write(note):
            self.permission_denied(
                request, message="You do not have edit permission on this note."
            )
        serializer = NoteRestoreVersionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        version_number = serializer.validated_data["version_number"]
        target = get_object_or_404(NoteVersion, note=note, version_number=version_number)
        note.body = target.body
        note.last_edited_by = request.user
        note.save(update_fields=["body", "last_edited_by", "updated_at"])
        return Response(NoteSerializer(note, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="save-snapshot")
    def save_snapshot(self, request: Request, pk: str | None = None) -> Response:
        """Persist an explicit body snapshot as a new :class:`NoteVersion`.

        Useful when a co-edit session wants to checkpoint without changing
        the body (e.g. before a risky transform). The body in the request
        body (``{"body": "..."}``) is used if provided; otherwise the
        current body is snapshotted.
        """
        note: Note = self.get_object()
        if not self._user_can_write(note):
            self.permission_denied(
                request, message="You do not have edit permission on this note."
            )
        body = request.data.get("body")
        if body is None:
            body = note.body
        elif not isinstance(body, str):
            return Response(
                {"detail": "body must be a string."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        version = NoteVersion.objects.create(
            note=note,
            user=request.user,
            body=body,
            version_number=note.next_version_number(),
        )
        return Response(
            NoteVersionSerializer(version, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    # ------------------------------------------------------------------ merge override (no-op)

    def _merge(self, source: Model, target: Model) -> None:  # type: ignore[override]
        """Notes cannot be merged — base ``merge`` action is a no-op."""
        return None
