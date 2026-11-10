"""URL routes for the reports app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from reports.viewsets import (
    ReportExecutionViewSet,
    ReportFolderViewSet,
    ReportViewSet,
)

router = DefaultRouter()
router.register(r"reports", ReportViewSet, basename="report")
router.register(r"report-folders", ReportFolderViewSet, basename="reportfolder")
router.register(
    r"report-executions", ReportExecutionViewSet, basename="reportexecution"
)

urlpatterns: list = list(router.urls)
