"""DRF ViewSets for the social app.

* :class:`SocialAccountViewSet` — CRUD on connected social accounts.
* :class:`SocialMentionViewSet` — list / retrieve + ``respond`` /
  ``mark_read`` / ``assign`` actions.
* :class:`ScheduledPostViewSet` — CRUD on queued outbound posts.
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
from social.filters import (
    ScheduledPostFilter,
    SocialAccountFilter,
    SocialMentionFilter,
)
from social.models import ScheduledPost, SocialAccount, SocialMention
from social.serializers import (
    ScheduledPostSerializer,
    SocialAccountSerializer,
    SocialMentionSerializer,
)
from social.services import respond_to_mention, sync_mentions


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve"):
        return [IsAuthenticated(), IsTenantMember()]
    return [IsAuthenticated(), IsTenantMember(), HasPermission("social.manage")]


###############################################################################
# SocialAccountViewSet
###############################################################################


class SocialAccountViewSet(ModelViewSet):
    """CRUD on :class:`SocialAccount`."""

    pagination_class = CRMCursorPagination
    serializer_class = SocialAccountSerializer
    filterset_class = SocialAccountFilter
    queryset = SocialAccount.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(self, serializer: SocialAccountSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    @action(detail=True, methods=["post"], url_path="sync")
    def sync(self, request: Request, pk: str | None = None) -> Response:
        """Trigger an immediate mention sync for this account."""
        account: SocialAccount = self.get_object()  # type: ignore[assignment]
        created = sync_mentions(account)
        return Response({"synced": len(created), "mention_ids": [m.pk for m in created]})


###############################################################################
# SocialMentionViewSet
###############################################################################


class SocialMentionViewSet(ModelViewSet):
    """List / retrieve + ``respond`` / ``mark_read`` / ``assign`` actions."""

    pagination_class = CRMCursorPagination
    serializer_class = SocialMentionSerializer
    filterset_class = SocialMentionFilter
    queryset = SocialMention.objects.select_related("tenant", "account", "assigned_to")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(self, serializer: SocialMentionSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    @action(detail=True, methods=["post"], url_path="respond")
    def respond(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{body}`` — reply on the provider and stamp ``responded_at``."""
        mention: SocialMention = self.get_object()  # type: ignore[assignment]
        body = request.data.get("body", "")
        if not body:
            return Response(
                {"detail": "body is required."}, status=status.HTTP_400_BAD_REQUEST
            )
        try:
            respond_to_mention(mention, body)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        mention.refresh_from_db()
        return Response(SocialMentionSerializer(mention).data)

    @action(detail=True, methods=["post"], url_path="mark_read")
    def mark_read(self, request: Request, pk: str | None = None) -> Response:
        """Toggle ``is_read`` (or set explicitly via ``is_read`` in the body)."""
        mention: SocialMention = self.get_object()  # type: ignore[assignment]
        if "is_read" in request.data:
            mention.is_read = bool(request.data["is_read"])
        else:
            mention.is_read = not mention.is_read
        mention.save(update_fields=["is_read", "updated_at"])
        return Response(SocialMentionSerializer(mention).data)

    @action(detail=True, methods=["post"], url_path="assign")
    def assign(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{user_id}`` — assign the mention to an agent."""
        mention: SocialMention = self.get_object()  # type: ignore[assignment]
        user_id = request.data.get("user_id")
        if not user_id:
            return Response(
                {"detail": "user_id is required."}, status=status.HTTP_400_BAD_REQUEST
            )
        from api.models import User  # noqa: PLC0415

        user = User.objects.filter(pk=user_id).first()
        if user is None:
            return Response(
                {"detail": "Unknown user_id."}, status=status.HTTP_400_BAD_REQUEST
            )
        mention.assigned_to = user
        mention.save(update_fields=["assigned_to", "updated_at"])
        return Response(SocialMentionSerializer(mention).data)


###############################################################################
# ScheduledPostViewSet
###############################################################################


class ScheduledPostViewSet(ModelViewSet):
    """CRUD on :class:`ScheduledPost`."""

    pagination_class = CRMCursorPagination
    serializer_class = ScheduledPostSerializer
    filterset_class = ScheduledPostFilter
    queryset = ScheduledPost.objects.select_related("tenant", "account")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(self, serializer: ScheduledPostSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


__all__ = [
    "ScheduledPostViewSet",
    "SocialAccountViewSet",
    "SocialMentionViewSet",
]
