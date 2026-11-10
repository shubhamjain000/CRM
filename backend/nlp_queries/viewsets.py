"""DRF ViewSets for the nlp_queries app.

* :class:`NLPQueryViewSet` — list / retrieve (caller-scoped) + ``ask``
  (POST ``{question}`` → parse + execute + persist) + ``save_as_report``
  (POST on detail).
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

from .models import NLPQuery
from .serializers import NLPQuerySerializer
from .services import execute_query, parse_query, save_as_report


class NLPQueryViewSet(ModelViewSet):
    """List / retrieve (caller-scoped) + ``ask`` + ``save_as_report``."""

    pagination_class = CRMCursorPagination
    serializer_class = NLPQuerySerializer
    queryset = NLPQuery.objects.select_related("tenant", "user")
    http_method_names = ["get", "post", "head", "options"]

    def get_permissions(self) -> Any:
        return [IsAuthenticated(), IsTenantMember()]

    def get_queryset(self) -> Any:  # type: ignore[override]
        qs = super().get_queryset()
        if self.action == "list":
            qs = qs.filter(user=self.request.user)
        return qs

    @action(detail=False, methods=["post"], url_path="ask")
    def ask(self, request: Request) -> Response:
        """POST ``{question}`` — parse + execute + persist the query."""
        question = request.data.get("question", "").strip()
        if not question:
            return Response(
                {"detail": "question is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        spec = parse_query(question)
        result = execute_query(spec, tenant=request.tenant)
        nlp = NLPQuery.objects.create(
            tenant=request.tenant,  # type: ignore[attr-defined]
            user=request.user,
            question=question,
            generated_spec=spec,
            result_summary=result["summary"],
        )
        return Response(
            {
                "query": NLPQuerySerializer(nlp).data,
                "result": result,
            }
        )

    @action(detail=True, methods=["post"], url_path="save_as_report")
    def save_as_report_action(self, request: Request, pk: str | None = None) -> Response:
        """POST — promote this query into a Report row."""
        result = save_as_report(pk, tenant=request.tenant)
        if "error" in result:
            return Response(result, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response(result, status=status.HTTP_201_CREATED)


__all__ = ["NLPQueryViewSet"]
