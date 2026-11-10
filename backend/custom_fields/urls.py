"""URL routes for the custom_fields app."""

from __future__ import annotations

from rest_framework.routers import DefaultRouter

from custom_fields.views import CustomFieldValueViewSet, CustomFieldViewSet

router = DefaultRouter()
router.register(r"custom-fields", CustomFieldViewSet, basename="custom-field")
router.register(
    r"custom-field-values",
    CustomFieldValueViewSet,
    basename="custom-field-value",
)

urlpatterns = router.urls
