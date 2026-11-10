"""DRF ViewSets for the unified inbox app.

* :class:`UnifiedConversationViewSet` — list / retrieve / create +
  ``messages`` / ``send_reply`` / ``assign`` / ``tag`` / ``snooze`` /
  ``merge`` / ``close`` / ``analytics`` actions.
* :class:`UnifiedMessageViewSet` — CRUD on individual messages.
* :class:`InboxMacroViewSet` — CRUD + ``execute``.
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
from inbox.filters import (
    InboxMacroFilter,
    UnifiedConversationFilter,
    UnifiedMessageFilter,
)
from inbox.models import InboxMacro, UnifiedConversation, UnifiedMessage
from inbox.serializers import (
    InboxMacroSerializer,
    UnifiedConversationSerializer,
    UnifiedMessageSerializer,
)
from inbox.services import (
    assign_conversation,
    execute_macro,
    get_analytics,
    merge_conversations,
    send_reply,
)


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve", "messages", "analytics"):
        return [IsAuthenticated(), IsTenantMember()]
    return [IsAuthenticated(), IsTenantMember(), HasPermission("inbox.manage")]


###############################################################################
# UnifiedConversationViewSet
###############################################################################


class UnifiedConversationViewSet(ModelViewSet):
    """CRUD + lifecycle actions on :class:`UnifiedConversation`."""

    pagination_class = CRMCursorPagination
    serializer_class = UnifiedConversationSerializer
    filterset_class = UnifiedConversationFilter
    queryset = UnifiedConversation.objects.select_related("tenant", "assigned_to", "merged_into")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: UnifiedConversationSerializer
    ) -> None:
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    def get_queryset(self) -> Any:  # type: ignore[override]
        # Hide merged conversations by default unless explicitly requested.
        qs = super().get_queryset()
        if self.request.query_params.get("include_merged") != "true":
            qs = qs.filter(is_merged=False)
        return qs

    @action(detail=True, methods=["get", "post"], url_path="messages")
    def messages(self, request: Request, pk: str | None = None) -> Response:
        """GET lists messages; POST appends an agent reply via :func:`send_reply`.

        POST body: ``{body, channel?}``.
        """
        conversation: UnifiedConversation = self.get_object()  # type: ignore[assignment]
        if request.method == "POST":
            try:
                msg = send_reply(
                    conversation=conversation,
                    body=request.data.get("body", ""),
                    channel=request.data.get("channel"),
                    user=request.user,
                )
            except ValueError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            return Response(UnifiedMessageSerializer(msg).data, status=status.HTTP_201_CREATED)
        qs = UnifiedMessage.objects.filter(conversation=conversation).order_by("timestamp")
        return Response(UnifiedMessageSerializer(qs, many=True).data)

    @action(detail=True, methods=["post"], url_path="send_reply")
    def send_reply(self, request: Request, pk: str | None = None) -> Response:
        """Alias for ``POST /messages/`` — kept for API discoverability."""
        return self.messages(request, pk)

    @action(detail=True, methods=["post"], url_path="assign")
    def assign(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{user_id}`` — assign the conversation to an agent."""
        conversation: UnifiedConversation = self.get_object()  # type: ignore[assignment]
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
        assign_conversation(conversation, user)
        return Response(UnifiedConversationSerializer(conversation).data)

    @action(detail=True, methods=["post"], url_path="tag")
    def tag(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{tags: ["vip", "enterprise"]}`` — replace the tag set."""
        conversation: UnifiedConversation = self.get_object()  # type: ignore[assignment]
        tags = request.data.get("tags")
        if not isinstance(tags, list):
            return Response(
                {"detail": "tags must be a list."}, status=status.HTTP_400_BAD_REQUEST
            )
        conversation.tags = tags
        conversation.save(update_fields=["tags", "updated_at"])
        return Response(UnifiedConversationSerializer(conversation).data)

    @action(detail=True, methods=["post"], url_path="snooze")
    def snooze(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{until, reason?}`` — set ``status=pending`` + internal note."""
        conversation: UnifiedConversation = self.get_object()  # type: ignore[assignment]
        until = request.data.get("until")
        if not until:
            return Response(
                {"detail": "until is required."}, status=status.HTTP_400_BAD_REQUEST
            )
        conversation.status = "pending"
        notes = list(conversation.internal_notes or [])
        notes.append(
            {
                "author": request.user.pk,
                "body": f"Snoozed until {until}. Reason: {request.data.get('reason', '')}",
                "timestamp": until,
            }
        )
        conversation.internal_notes = notes
        conversation.save(update_fields=["status", "internal_notes", "updated_at"])
        return Response(UnifiedConversationSerializer(conversation).data)

    @action(detail=True, methods=["post"], url_path="merge")
    def merge(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{target_id}`` — merge this conversation into ``target_id``."""
        source: UnifiedConversation = self.get_object()  # type: ignore[assignment]
        target_id = request.data.get("target_id")
        target = UnifiedConversation.objects.filter(
            tenant=source.tenant, pk=target_id, is_merged=False
        ).first()
        if target is None:
            return Response(
                {"detail": "A valid non-merged target_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            merge_conversations(source, target)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(UnifiedConversationSerializer(target).data)

    @action(detail=True, methods=["post"], url_path="close")
    def close(self, request: Request, pk: str | None = None) -> Response:
        """Close the conversation (status=closed)."""
        conversation: UnifiedConversation = self.get_object()  # type: ignore[assignment]
        conversation.status = "closed"
        conversation.save(update_fields=["status", "updated_at"])
        return Response(UnifiedConversationSerializer(conversation).data)

    @action(detail=False, methods=["get"], url_path="analytics")
    def analytics(self, request: Request) -> Response:
        """GET ``?channel=...&status=...`` — aggregate inbox analytics."""
        filters = {
            "channel": request.query_params.get("channel"),
            "status": request.query_params.get("status"),
            "assigned_to": request.query_params.get("assigned_to"),
            "priority": request.query_params.get("priority"),
        }
        filters = {k: v for k, v in filters.items() if v}
        return Response(get_analytics(filters))


###############################################################################
# UnifiedMessageViewSet
###############################################################################


class UnifiedMessageViewSet(ModelViewSet):
    """CRUD on :class:`UnifiedMessage`."""

    pagination_class = CRMCursorPagination
    serializer_class = UnifiedMessageSerializer
    filterset_class = UnifiedMessageFilter
    queryset = UnifiedMessage.objects.select_related("tenant", "conversation")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: UnifiedMessageSerializer
    ) -> None:
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


###############################################################################
# InboxMacroViewSet
###############################################################################


class InboxMacroViewSet(ModelViewSet):
    """CRUD + ``execute`` on :class:`InboxMacro`."""

    pagination_class = CRMCursorPagination
    serializer_class = InboxMacroSerializer
    filterset_class = InboxMacroFilter
    queryset = InboxMacro.objects.select_related("tenant", "created_by")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: InboxMacroSerializer
    ) -> None:
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant, created_by=self.request.user
        )

    @action(detail=True, methods=["post"], url_path="execute")
    def execute(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{conversation_id}`` — apply every action in the macro."""
        macro: InboxMacro = self.get_object()  # type: ignore[assignment]
        conversation_id = request.data.get("conversation_id")
        if not conversation_id:
            return Response(
                {"detail": "conversation_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            result = execute_macro(
                macro.pk, int(conversation_id), user=request.user
            )
        except UnifiedConversation.DoesNotExist:
            return Response(
                {"detail": "Unknown conversation_id."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(result)


__all__ = [
    "InboxMacroViewSet",
    "UnifiedConversationViewSet",
    "UnifiedMessageViewSet",
]
