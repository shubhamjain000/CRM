"""DRF ViewSets for the smart_suggestions app.

* :class:`SmartSuggestionViewSet` — CRUD (scoped to the caller's user) +
  ``generate`` (POST) + ``accept`` (POST on detail) + ``dismiss`` (POST
  on detail).
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

from .models import SmartSuggestion
from .serializers import SmartSuggestionSerializer
from .services import accept_suggestion, dismiss_suggestion, generate_suggestions


class SmartSuggestionViewSet(ModelViewSet):
    """CRUD (caller-scoped) + ``generate`` / ``accept`` / ``dismiss``."""

    pagination_class = CRMCursorPagination
    serializer_class = SmartSuggestionSerializer
    queryset = SmartSuggestion.objects.select_related("tenant", "user")
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_permissions(self) -> Any:
        return [IsAuthenticated(), IsTenantMember()]

    def get_queryset(self) -> Any:  # type: ignore[override]
        qs = super().get_queryset()
        if self.action == "list":
            qs = qs.filter(user=self.request.user)
        return qs

    def perform_create(  # type: ignore[override]
        self, serializer: SmartSuggestionSerializer
    ) -> None:
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant, user=self.request.user
        )

    @action(detail=False, methods=["post"], url_path="generate")
    def generate(self, request: Request) -> Response:
        """POST — generate next-best-action suggestions for the caller."""
        result = generate_suggestions(request.user)
        return Response(result, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="accept")
    def accept(self, request: Request, pk: str | None = None) -> Response:
        """POST — mark the suggestion accepted."""
        suggestion = accept_suggestion(pk, user=request.user)
        return Response(SmartSuggestionSerializer(suggestion).data)

    @action(detail=True, methods=["post"], url_path="dismiss")
    def dismiss(self, request: Request, pk: str | None = None) -> Response:
        """POST — mark the suggestion dismissed."""
        suggestion = dismiss_suggestion(pk, user=request.user)
        return Response(SmartSuggestionSerializer(suggestion).data)


__all__ = ["SmartSuggestionViewSet"]
