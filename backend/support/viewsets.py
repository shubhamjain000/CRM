"""DRF ViewSets for the support app.

* :class:`TicketViewSet` — CRUD + ``reply`` + ``resolve`` + ``close``.
* :class:`TicketReplyViewSet` — CRUD.
* :class:`KnowledgeBaseArticleViewSet` — CRUD.
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

from .models import KnowledgeBaseArticle, T_CLOSED, T_RESOLVED, Ticket, TicketReply
from .serializers import (
    KnowledgeBaseArticleSerializer,
    TicketReplySerializer,
    TicketSerializer,
)


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve"):
        return [IsAuthenticated(), IsTenantMember()]
    return [IsAuthenticated(), IsTenantMember(), HasPermission("support.manage")]


class TicketViewSet(ModelViewSet):
    """CRUD on :class:`Ticket` + ``reply`` + ``resolve`` + ``close``."""

    pagination_class = CRMCursorPagination
    serializer_class = TicketSerializer
    queryset = Ticket.objects.select_related("tenant", "assigned_to")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(self, serializer: TicketSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    @action(detail=True, methods=["post"], url_path="reply")
    def reply(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{body, is_internal?}`` — append a :class:`TicketReply`."""
        ticket: Ticket = self.get_object()  # type: ignore[assignment]
        body = request.data.get("body", "")
        if not body:
            return Response(
                {"detail": "body is required."}, status=status.HTTP_400_BAD_REQUEST
            )
        reply = TicketReply.objects.create(
            tenant=request.tenant,
            ticket=ticket,
            author=request.user,
            body=body,
            is_internal=bool(request.data.get("is_internal", False)),
        )
        return Response(TicketReplySerializer(reply).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="resolve")
    def resolve(self, request: Request, pk: str | None = None) -> Response:
        """POST — flip status to ``resolved``."""
        ticket: Ticket = self.get_object()  # type: ignore[assignment]
        ticket.status = T_RESOLVED
        ticket.save(update_fields=["status", "updated_at"])
        return Response(TicketSerializer(ticket).data)

    @action(detail=True, methods=["post"], url_path="close")
    def close(self, request: Request, pk: str | None = None) -> Response:
        """POST — flip status to ``closed``."""
        ticket: Ticket = self.get_object()  # type: ignore[assignment]
        ticket.status = T_CLOSED
        ticket.save(update_fields=["status", "updated_at"])
        return Response(TicketSerializer(ticket).data)


class TicketReplyViewSet(ModelViewSet):
    """CRUD on :class:`TicketReply`."""

    pagination_class = CRMCursorPagination
    serializer_class = TicketReplySerializer
    queryset = TicketReply.objects.select_related("tenant", "ticket", "author")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(self, serializer: TicketReplySerializer) -> None:  # type: ignore[override]
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant, author=self.request.user
        )


class KnowledgeBaseArticleViewSet(ModelViewSet):
    """CRUD on :class:`KnowledgeBaseArticle`."""

    pagination_class = CRMCursorPagination
    serializer_class = KnowledgeBaseArticleSerializer
    queryset = KnowledgeBaseArticle.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: KnowledgeBaseArticleSerializer
    ) -> None:
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


__all__ = [
    "KnowledgeBaseArticleViewSet",
    "TicketReplyViewSet",
    "TicketViewSet",
]
