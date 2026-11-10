"""DRF ViewSets for the livechat app.

* :class:`ChatSessionViewSet` — CRUD on sessions + ``assign`` / ``end`` /
  ``convert_to_lead`` / ``messages`` actions.
* :class:`ChatMessageViewSet` — CRUD on individual messages.
* :class:`CannedResponseViewSet` — CRUD on canned responses.
* :class:`ProactiveRuleViewSet` — CRUD on proactive-invitation rules.
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
from livechat.filters import (
    CannedResponseFilter,
    ChatMessageFilter,
    ChatSessionFilter,
    ProactiveRuleFilter,
)
from livechat.models import ChatMessage, ChatSession, CannedResponse, ProactiveRule
from livechat.serializers import (
    CannedResponseSerializer,
    ChatMessageSerializer,
    ChatSessionSerializer,
    ProactiveRuleSerializer,
)
from livechat.services import (
    assign_session,
    convert_to_lead,
    create_session,
    end_session,
    send_message,
)


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve", "messages"):
        return [IsAuthenticated(), IsTenantMember()]
    return [IsAuthenticated(), IsTenantMember(), HasPermission("livechat.manage")]


###############################################################################
# ChatSessionViewSet
###############################################################################


class ChatSessionViewSet(ModelViewSet):
    """CRUD on :class:`ChatSession` + lifecycle actions."""

    pagination_class = CRMCursorPagination
    serializer_class = ChatSessionSerializer
    filterset_class = ChatSessionFilter
    queryset = ChatSession.objects.select_related("tenant", "assigned_to")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(self, serializer: ChatSessionSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    @action(detail=True, methods=["post"], url_path="assign")
    def assign(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{user_id}`` — assign the session to an agent."""
        session: ChatSession = self.get_object()  # type: ignore[assignment]
        user_id = request.data.get("user_id") or request.user.pk
        from api.models import User  # noqa: PLC0415

        user = User.objects.filter(pk=user_id).first()
        if user is None:
            return Response(
                {"detail": "Unknown user_id."}, status=status.HTTP_400_BAD_REQUEST
            )
        assign_session(session, user)
        return Response(ChatSessionSerializer(session).data)

    @action(detail=True, methods=["post"], url_path="end")
    def end(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{satisfaction?}`` — end the session."""
        session: ChatSession = self.get_object()  # type: ignore[assignment]
        satisfaction = request.data.get("satisfaction")
        end_session(session, satisfaction=satisfaction)
        return Response(ChatSessionSerializer(session).data)

    @action(detail=True, methods=["post"], url_path="convert_to_lead")
    def convert_to_lead(self, request: Request, pk: str | None = None) -> Response:
        """Promote the session to a :class:`leads.models.Lead`."""
        session: ChatSession = self.get_object()  # type: ignore[assignment]
        try:
            lead = convert_to_lead(session)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"lead_id": lead.pk}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get", "post"], url_path="messages")
    def messages(self, request: Request, pk: str | None = None) -> Response:
        """GET lists messages; POST appends a message via :func:`send_message`.

        POST body: ``{sender, body, attachments?}``.
        """
        session: ChatSession = self.get_object()  # type: ignore[assignment]
        if request.method == "POST":
            try:
                msg = send_message(
                    session=session,
                    sender=request.data.get("sender", "agent"),
                    body=request.data.get("body", ""),
                    attachments=request.data.get("attachments"),
                )
            except ValueError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            return Response(ChatMessageSerializer(msg).data, status=status.HTTP_201_CREATED)
        qs = ChatMessage.objects.filter(session=session).order_by("timestamp")
        return Response(ChatMessageSerializer(qs, many=True).data)


###############################################################################
# ChatMessageViewSet
###############################################################################


class ChatMessageViewSet(ModelViewSet):
    """CRUD on :class:`ChatMessage`."""

    pagination_class = CRMCursorPagination
    serializer_class = ChatMessageSerializer
    filterset_class = ChatMessageFilter
    queryset = ChatMessage.objects.select_related("tenant", "session")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(self, serializer: ChatMessageSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


###############################################################################
# CannedResponseViewSet
###############################################################################


class CannedResponseViewSet(ModelViewSet):
    """CRUD on :class:`CannedResponse`."""

    pagination_class = CRMCursorPagination
    serializer_class = CannedResponseSerializer
    filterset_class = CannedResponseFilter
    queryset = CannedResponse.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: CannedResponseSerializer
    ) -> None:
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


###############################################################################
# ProactiveRuleViewSet
###############################################################################


class ProactiveRuleViewSet(ModelViewSet):
    """CRUD on :class:`ProactiveRule`."""

    pagination_class = CRMCursorPagination
    serializer_class = ProactiveRuleSerializer
    filterset_class = ProactiveRuleFilter
    queryset = ProactiveRule.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(self, serializer: ProactiveRuleSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


__all__ = [
    "CannedResponseViewSet",
    "ChatMessageViewSet",
    "ChatSessionViewSet",
    "ProactiveRuleViewSet",
]
