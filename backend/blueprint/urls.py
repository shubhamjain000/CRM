"""URL routes for the blueprint app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from blueprint.viewsets import (
    BlueprintExecutionViewSet,
    BlueprintStateViewSet,
    BlueprintTransitionViewSet,
    BlueprintViewSet,
)

router = DefaultRouter()
router.register(r"blueprints", BlueprintViewSet, basename="blueprint")
router.register(r"blueprint-states", BlueprintStateViewSet, basename="blueprintstate")
router.register(
    r"blueprint-transitions", BlueprintTransitionViewSet, basename="blueprinttransition"
)
router.register(
    r"blueprint-executions", BlueprintExecutionViewSet, basename="blueprintexecution"
)

urlpatterns = router.urls
