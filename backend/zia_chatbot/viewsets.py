"""DRF ViewSets for the zia_chatbot app.

* :class:`ZiaConversationViewSet` — list / retrieve (caller-scoped) +
  ``send_message`` (POST ``{message}``) + ``history`` (GET) + ``clear``
  (POST).
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
from api.permissions import IsTenantMember

from .models import ZiaConversation
from .serializers import SendMessageSerializer, ZiaConversationSerializer
from .services import chat, clear_history, get_history


class ZiaConversationViewSet(ModelViewSet):
    """List / retrieve + ``send_message`` / ``history`` / ``clear``."""

    pagination_class = CRMCursorPagination
    serializer_class = ZiaConversationSerializer
    queryset = ZiaConversation.objects.select_related("tenant", "user")
    http_method_names = ["get", "post", "head", "options"]

    def get_permissions(self) -> Any:
        return [IsAuthenticated(), IsTenantMember()]

    def get_queryset(self) -> Any:  # type: ignore[override]
        qs = super().get_queryset()
        if self.action == "list":
            qs = qs.filter(user=self.request.user)
        return qs

    @action(detail=False, methods=["post"], url_path="send_message")
    def send_message(self, request: Request) -> Response:
        """POST ``{message}`` — send a message and return Zia's response."""
        ser = SendMessageSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        result = chat(request.user, ser.validated_data["message"])
        return Response(result, status=status.HTTP_200_OK)

    @action(detail=False, methods=["get"], url_path="history")
    def history(self, request: Request) -> Response:
        """GET — return the caller's conversation messages."""
        convo = get_history(request.user)
        return Response(ZiaConversationSerializer(convo).data)

    @action(detail=False, methods=["post"], url_path="clear")
    def clear(self, request: Request) -> Response:
        """POST — wipe the caller's conversation messages."""
        convo = clear_history(request.user)
        return Response(ZiaConversationSerializer(convo).data)


__all__ = ["ZiaConversationViewSet"]
