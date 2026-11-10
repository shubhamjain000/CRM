"""DRF ViewSets for the notifications app.

All viewsets are tenant-scoped (resolved by
:class:`api.middleware.TenantMiddleware`) and require ``IsAuthenticated`` +
``IsTenantMember``. Every viewset restricts the queryset to the caller's own
rows — a user can only ever see their own notifications, preferences, and
quiet-hours.
"""

from __future__ import annotations

from typing import Any

from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import CursorPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from api.permissions import IsTenantMember

from .models import Notification, NotificationPreference, QuietHours
from .serializers import (
    NotificationPreferenceSerializer,
    NotificationSerializer,
    QuietHoursSerializer,
)
from .services import get_unread_count, mark_all_read


class NotificationCursorPagination(CursorPagination):
    """Cursor pagination for notifications (page_size 50, max 200)."""

    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200
    ordering = "-created_at"


###############################################################################
# Notification
##############################################################################


class NotificationViewSet(viewsets.ReadOnlyModelViewSet, viewsets.GenericViewSet):
    """Tenant-scoped notifications for the current user.

    * ``list`` returns the caller's notifications, optionally narrowed by
      ``?unread_only=true`` and ``?channel=in_app``. The queryset is always
      scoped to ``recipient=request.user`` — recipients cannot read other
      users' notifications.
    * ``create`` is supported but only for in-app notifications the caller
      explicitly wants to push to themselves (rare; e.g. a system-triggered
      reminder the user wants to confirm). The recipient is always set to
      ``request.user``.
    * ``mark_read`` (POST, body ``{"ids": [...]}`` or no body to mark all)
      stamps ``read_at`` on the supplied rows (or all unread rows).
    * ``mark_all_read`` (POST) is a shortcut for the no-body form of
      ``mark_read``.
    * ``archive`` (POST, body ``{"ids": [...]}``) marks rows as archived
      (sets ``read_at`` + ``data.archived=True``).
    * ``unread_count`` (GET) returns the count of unread in-app rows.
    """

    serializer_class = NotificationSerializer
    queryset = Notification.objects.all()
    permission_classes = [IsAuthenticated, IsTenantMember]
    pagination_class = NotificationCursorPagination

    def get_queryset(self) -> Any:  # type: ignore[override]
        queryset = (
            super()
            .get_queryset()
            .filter(recipient=self.request.user)
            .select_related("actor", "actor__profile")
        )
        query = self.request.query_params
        if (query.get("unread_only") or "").lower() == "true":
            queryset = queryset.filter(read_at__isnull=True)
        channel = query.get("channel")
        if channel:
            queryset = queryset.filter(channel=channel)
        return queryset

    def create(self, request: Request, *args: Any, **kwargs: Any) -> Response:  # type: ignore[override]
        """Create an in-app notification addressed to the caller."""
        from .services import create_notification

        verb = request.data.get("verb")
        if not verb:
            return Response(
                {"detail": "verb is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        notification = create_notification(
            tenant=request.tenant,  # type: ignore[attr-defined]
            actor=request.user,
            verb=verb,
            target_module=request.data.get("target_module", ""),
            target_id=str(request.data.get("target_id", "")),
            target_name=request.data.get("target_name", ""),
            recipient=request.user,
            data=request.data.get("data") or {},
        )
        return Response(
            NotificationSerializer(notification, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    # ------------------------------------------------------------------ actions

    @action(detail=False, methods=["post"], url_path="mark-read")
    def mark_read(self, request: Request) -> Response:
        """Mark the supplied notifications (or all unread) as read."""
        ids = request.data.get("ids") or []
        queryset = self.get_queryset().filter(read_at__isnull=True)
        if isinstance(ids, list) and ids:
            queryset = queryset.filter(pk__in=ids)
        updated = queryset.update(read_at=timezone.now())
        return Response({"updated": updated})

    @action(detail=False, methods=["post"], url_path="mark-all-read")
    def mark_all_read_action(self, request: Request) -> Response:
        """Mark every unread notification for the caller as read."""
        updated = mark_all_read(request.user)
        return Response({"updated": updated})

    @action(detail=False, methods=["post"], url_path="archive")
    def archive(self, request: Request) -> Response:
        """Archive the supplied notification IDs (sets ``data.archived=True``)."""
        ids = request.data.get("ids") or []
        if not isinstance(ids, list) or not ids:
            return Response(
                {"detail": "ids must be a non-empty list."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        queryset = self.get_queryset().filter(pk__in=ids)
        updated = 0
        now = timezone.now()
        for notification in queryset:
            data = dict(notification.data or {})
            data["archived"] = True
            notification.data = data
            notification.read_at = notification.read_at or now
            notification.save(update_fields=["data", "read_at", "updated_at"])
            updated += 1
        return Response({"archived": updated})

    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request: Request) -> Response:
        """Return the caller's unread in-app notification count."""
        return Response({"unread_count": get_unread_count(request.user)})


###############################################################################
# NotificationPreference
##############################################################################


class NotificationPreferenceViewSet(viewsets.ModelViewSet):
    """Per-user, per-type notification preferences.

    * ``list`` returns the caller's preference rows. ``create`` auto-stamps
      ``user`` and ``tenant``. ``update`` / ``destroy`` are owner-only (the
      queryset is already scoped to ``user=request.user`` so this is
      enforced implicitly).
    * The caller can also ``PUT`` to a (notification_type, user) pair via
      ``/notification-preferences/{id}/`` (standard DRF update).
    """

    serializer_class = NotificationPreferenceSerializer
    queryset = NotificationPreference.objects.all()
    permission_classes = [IsAuthenticated, IsTenantMember]
    pagination_class = None

    def get_queryset(self) -> Any:  # type: ignore[override]
        return super().get_queryset().filter(user=self.request.user)

    def perform_create(self, serializer: NotificationPreferenceSerializer) -> None:  # type: ignore[override]
        serializer.save(
            tenant=self.request.tenant,  # type: ignore[attr-defined]
            user=self.request.user,
        )


###############################################################################
# QuietHours (singleton per user)
##############################################################################


class QuietHoursViewSet(viewsets.ViewSet):
    """Singleton quiet-hours config for the current user.

    * ``GET /quiet-hours/`` returns the caller's quiet-hours row (or ``null``
      if not configured).
    * ``PUT /quiet-hours/`` upserts the row.
    * ``DELETE /quiet-hours/`` disables quiet hours (sets ``enabled=False``).
    """

    permission_classes = [IsAuthenticated, IsTenantMember]
    pagination_class = None

    def _serializer(self, instance: QuietHours | None, *, request: Request) -> QuietHoursSerializer:
        return QuietHoursSerializer(instance, context={"request": request})

    def list(self, request: Request) -> Response:  # type: ignore[override]
        instance = QuietHours.objects.filter(
            tenant=request.tenant,  # type: ignore[attr-defined]
            user=request.user,
        ).first()
        if instance is None:
            return Response(None)
        return Response(self._serializer(instance, request=request).data)

    def create(self, request: Request) -> Response:  # type: ignore[override]
        # Treat POST as an upsert for the singleton row.
        return self._upsert(request)

    def update(self, request: Request, pk: str | None = None) -> Response:  # type: ignore[override]
        return self._upsert(request)

    def partial_update(self, request: Request, pk: str | None = None) -> Response:  # type: ignore[override]
        return self._upsert(request, partial=True)

    def destroy(self, request: Request, pk: str | None = None) -> Response:  # type: ignore[override]
        instance = QuietHours.objects.filter(
            tenant=request.tenant,  # type: ignore[attr-defined]
            user=request.user,
        ).first()
        if instance is None:
            return Response(status=status.HTTP_204_NO_CONTENT)
        instance.enabled = False
        instance.save(update_fields=["enabled", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ------------------------------------------------------------------ helpers

    def _upsert(self, request: Request, *, partial: bool = False) -> Response:
        instance = QuietHours.objects.filter(
            tenant=request.tenant,  # type: ignore[attr-defined]
            user=request.user,
        ).first()
        serializer = QuietHoursSerializer(
            instance,
            data=request.data,
            partial=partial or instance is not None,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save(
            tenant=request.tenant,  # type: ignore[attr-defined]
            user=request.user,
        )
        status_code = status.HTTP_200_OK if instance is not None else status.HTTP_201_CREATED
        return Response(serializer.data, status=status_code)
