"""URL routes for the compliance app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from .viewsets import (
    ComplianceChecklistViewSet,
    ComplianceFrameworkViewSet,
    DataProcessingConsentViewSet,
)

router = DefaultRouter()
router.register(
    r"compliance-frameworks",
    ComplianceFrameworkViewSet,
    basename="compliance-framework",
)
router.register(
    r"compliance-checklists",
    ComplianceChecklistViewSet,
    basename="compliance-checklist",
)
router.register(
    r"data-processing-consents",
    DataProcessingConsentViewSet,
    basename="data-processing-consent",
)

urlpatterns: list = list(router.urls)
