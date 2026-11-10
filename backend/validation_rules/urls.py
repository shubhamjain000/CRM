"""URL routes for the validation_rules app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from validation_rules.viewsets import ValidationRuleViewSet

router = DefaultRouter()
router.register(r"validation-rules", ValidationRuleViewSet, basename="validationrule")

urlpatterns = router.urls
