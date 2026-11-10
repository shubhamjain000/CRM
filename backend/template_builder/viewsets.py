"""DRF ViewSets for the template_builder app.

* :class:`EmailTemplateViewSet` — CRUD + ``preview`` + ``render``.
* :class:`PdfTemplateViewSet` — CRUD + ``preview`` + ``render``.

The ``preview`` action takes no body and renders the template against
the built-in sample data for the template's category. The ``render``
action takes a JSON body of data and returns the rendered HTML.
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

from .filters import EmailTemplateFilter, PdfTemplateFilter
from .models import EmailTemplate, PdfTemplate
from .serializers import EmailTemplateSerializer, PdfTemplateSerializer
from .services import preview_data, render_html


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve", "preview", "render"):
        return [IsAuthenticated(), IsTenantMember()]
    return [IsAuthenticated(), IsTenantMember(), HasPermission("template_builder.manage")]


def _render_template(
    source: str, category: str, data: dict[str, Any] | None
) -> str:
    """Render ``source`` against ``data`` (or the sample payload for ``category``)."""
    payload = data if data is not None else preview_data(category)
    return render_html(source, payload)


###############################################################################
# EmailTemplateViewSet
###############################################################################


class EmailTemplateViewSet(ModelViewSet):
    """CRUD + ``preview`` + ``render`` on :class:`EmailTemplate`."""

    pagination_class = CRMCursorPagination
    serializer_class = EmailTemplateSerializer
    filterset_class = EmailTemplateFilter
    queryset = EmailTemplate.objects.select_related("tenant").all()

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: EmailTemplateSerializer
    ) -> None:
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant
        )

    @action(detail=True, methods=["get"], url_path="preview")
    def preview(self, request: Request, pk: str | None = None) -> Response:
        """GET — render subject + body with built-in sample data."""
        template: EmailTemplate = self.get_object()  # type: ignore[assignment]
        sample = {"first_name": "Alex", "company": "Acme"}
        return Response({
            "subject": _render_template(template.subject, "onboarding", sample),
            "body_html": _render_template(template.body_html, "onboarding", sample),
        })

    @action(detail=True, methods=["post"], url_path="render")
    def render(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{data: {...}}`` — render subject + body with caller-supplied data."""
        template: EmailTemplate = self.get_object()  # type: ignore[assignment]
        data = (request.data or {}).get("data")
        if not isinstance(data, dict):
            return Response(
                {"detail": "data must be a JSON object."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({
            "subject": render_html(template.subject, data),
            "body_html": render_html(template.body_html, data),
        })


###############################################################################
# PdfTemplateViewSet
###############################################################################


class PdfTemplateViewSet(ModelViewSet):
    """CRUD + ``preview`` + ``render`` on :class:`PdfTemplate`."""

    pagination_class = CRMCursorPagination
    serializer_class = PdfTemplateSerializer
    filterset_class = PdfTemplateFilter
    queryset = PdfTemplate.objects.select_related("tenant").all()

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: PdfTemplateSerializer
    ) -> None:
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant
        )

    @action(detail=True, methods=["get"], url_path="preview")
    def preview(self, request: Request, pk: str | None = None) -> Response:
        """GET — render html_template (+ inline css) with sample data for the category."""
        template: PdfTemplate = self.get_object()  # type: ignore[assignment]
        html = _render_template(template.html_template, template.category, None)
        if template.css:
            html = f"<style>{template.css}</style>\n{html}"
        return Response({"html": html})

    @action(detail=True, methods=["post"], url_path="render")
    def render(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{data: {...}}`` — render html_template with caller-supplied data."""
        template: PdfTemplate = self.get_object()  # type: ignore[assignment]
        data = (request.data or {}).get("data")
        if not isinstance(data, dict):
            return Response(
                {"detail": "data must be a JSON object."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        html = render_html(template.html_template, data)
        if template.css:
            html = f"<style>{template.css}</style>\n{html}"
        return Response({"html": html})


__all__ = ["EmailTemplateViewSet", "PdfTemplateViewSet"]
