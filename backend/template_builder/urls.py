"""URL routes for the template_builder app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import EmailTemplateViewSet, PdfTemplateViewSet

router = DefaultRouter()
router.register(r"email-templates", EmailTemplateViewSet, basename="emailtemplate")
router.register(r"pdf-templates", PdfTemplateViewSet, basename="pdftemplate")

urlpatterns: list = list(router.urls)
