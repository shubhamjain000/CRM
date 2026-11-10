"""URL routes for the scheduled_actions app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from scheduled_actions.viewsets import (
    ScheduledJobLogViewSet,
    ScheduledJobViewSet,
)

router = DefaultRouter()
router.register(r"scheduled-jobs", ScheduledJobViewSet, basename="scheduledjob")
router.register(r"scheduled-job-logs", ScheduledJobLogViewSet, basename="scheduledjoblog")

urlpatterns = router.urls
