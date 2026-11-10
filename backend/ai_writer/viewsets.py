"""DRF ViewSets for the ai_writer app.

* :class:`AIWriterDraftViewSet` — CRUD + ``generate_email`` +
  ``generate_summary`` + ``generate_subjects``.
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

from .models import AIWriterDraft
from .serializers import (
    AIWriterDraftSerializer,
    GenerateEmailSerializer,
    GenerateSubjectsSerializer,
    GenerateSummarySerializer,
)
from .services import (
    generate_email,
    generate_subject_lines,
    generate_summary,
)


class AIWriterDraftViewSet(ModelViewSet):
    """CRUD + ``generate_email`` / ``generate_summary`` / ``generate_subjects``."""

    pagination_class = CRMCursorPagination
    serializer_class = AIWriterDraftSerializer
    queryset = AIWriterDraft.objects.select_related("tenant", "user")

    def get_permissions(self) -> Any:
        return [IsAuthenticated(), IsTenantMember()]

    def get_queryset(self) -> Any:  # type: ignore[override]
        qs = super().get_queryset()
        if self.action == "list":
            qs = qs.filter(user=self.request.user)
        return qs

    def perform_create(  # type: ignore[override]
        self, serializer: AIWriterDraftSerializer
    ) -> None:
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant, user=self.request.user
        )

    @action(detail=False, methods=["post"], url_path="generate_email")
    def generate_email_action(self, request: Request) -> Response:
        """POST ``{prompt, style?, tone?}`` — draft an email."""
        ser = GenerateEmailSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        draft = generate_email(
            ser.validated_data["prompt"],
            style=ser.validated_data["style"],
            tone=ser.validated_data["tone"],
            user=request.user,
            tenant=request.tenant,
        )
        return Response(
            AIWriterDraftSerializer(draft).data, status=status.HTTP_201_CREATED
        )

    @action(detail=False, methods=["post"], url_path="generate_summary")
    def generate_summary_action(self, request: Request) -> Response:
        """POST ``{text}`` — summarize the text."""
        ser = GenerateSummarySerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        draft = generate_summary(
            ser.validated_data["text"],
            user=request.user,
            tenant=request.tenant,
        )
        return Response(
            AIWriterDraftSerializer(draft).data, status=status.HTTP_201_CREATED
        )

    @action(detail=False, methods=["post"], url_path="generate_subjects")
    def generate_subjects(self, request: Request) -> Response:
        """POST ``{email_body}`` — return 3-5 subject-line candidates."""
        ser = GenerateSubjectsSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        subjects = generate_subject_lines(
            ser.validated_data["email_body"],
            user=request.user,
            tenant=request.tenant,
        )
        return Response({"subjects": subjects}, status=status.HTTP_200_OK)


__all__ = ["AIWriterDraftViewSet"]
