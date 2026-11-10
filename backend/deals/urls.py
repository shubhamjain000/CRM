"""URL routes for the deals app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from deals.views import (
    DealViewSet,
    PipelineViewSet,
    StageViewSet,
    StageTransitionViewSet,
)

router = DefaultRouter()
router.register(r"deals", DealViewSet, basename="deal")
router.register(r"pipelines", PipelineViewSet, basename="pipeline")
router.register(r"stages", StageViewSet, basename="stage")
router.register(r"stage-transitions", StageTransitionViewSet, basename="stagetransition")

urlpatterns = router.urls
