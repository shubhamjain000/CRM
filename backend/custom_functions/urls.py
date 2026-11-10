"""URL routes for the custom_functions app.

DRF router for the five viewsets plus a standalone webhook endpoint that
external systems can POST to (API-key authenticated) to trigger a
function synchronously.
"""

from __future__ import annotations

from typing import Any

from django.urls import path
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.routers import DefaultRouter

from api.models import ApiKey
from api.utils import hash_token
from custom_functions.models import CustomFunction, TRIGGER_WEBHOOK
from custom_functions.serializers import CustomFunctionExecutionSerializer
from custom_functions.services import CustomFunctionService
from custom_functions.viewsets import (
    CustomFunctionExecutionViewSet,
    CustomFunctionViewSet,
    HttpAllowlistViewSet,
    HttpCallLogViewSet,
    KVStoreViewSet,
)

router = DefaultRouter()
router.register(r"custom-functions", CustomFunctionViewSet, basename="customfunction")
router.register(
    r"custom-function-executions",
    CustomFunctionExecutionViewSet,
    basename="customfunctionexecution",
)
router.register(r"http-allowlist", HttpAllowlistViewSet, basename="httpallowlist")
router.register(r"http-call-logs", HttpCallLogViewSet, basename="httpcalllog")
router.register(r"kv-store", KVStoreViewSet, basename="kvstore")


###############################################################################
# Webhook endpoint — API-key authenticated
###############################################################################


def _resolve_api_key(request: Request) -> ApiKey | None:
    """Resolve an :class:`ApiKey` from the ``X-API-Key`` header.

    Returns ``None`` if the header is missing or the key has expired.
    Updates ``last_used`` on success.
    """
    raw = request.headers.get("X-API-Key", "").strip()
    if not raw:
        return None
    key_hash = hash_token(raw)
    api_key = (
        ApiKey.objects.select_related("tenant", "user")
        .filter(key_hash=key_hash, tenant__is_active=True)
        .first()
    )
    if api_key is None:
        return None
    if api_key.expires_at is not None and api_key.expires_at < timezone.now():
        return None
    api_key.last_used = timezone.now()
    api_key.save(update_fields=["last_used"])
    return api_key


@api_view(["POST"])
@permission_classes([AllowAny])
def custom_function_webhook(request: Request, function_id: int) -> Response:
    """POST ``/api/v1/custom-functions/<function_id>/webhook/``.

    External systems can invoke an approved function via API key. The
    request body becomes ``input_data``. Returns the
    :class:`CustomFunctionExecution` row.

    Authentication: ``X-API-Key`` header → SHA-256 hash → :class:`ApiKey`
    lookup. The key's tenant must match the function's tenant.

    The function must be active + approved. Manual-only functions cannot
    be invoked via this endpoint.
    """
    api_key = _resolve_api_key(request)
    if api_key is None:
        return Response(
            {"detail": "Invalid or missing API key."},
            status=status.HTTP_401_UNAUTHORIZED,
        )
    function = (
        CustomFunction.objects.select_related("tenant")
        .filter(pk=function_id, tenant=api_key.tenant)
        .first()
    )
    if function is None:
        return Response(
            {"detail": "Function not found."}, status=status.HTTP_404_NOT_FOUND
        )
    if not function.is_active:
        return Response(
            {"detail": "Function is not active."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not function.is_approved:
        return Response(
            {"detail": "Function is not approved for production triggers."},
            status=status.HTTP_403_FORBIDDEN,
        )
    try:
        execution = CustomFunctionService().execute(
            function_id=function.pk,
            input_data=request.data,
            trigger=TRIGGER_WEBHOOK,
            user=api_key.user,
        )
    except (ValueError, PermissionError) as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(CustomFunctionExecutionSerializer(execution).data)


###############################################################################
# urlpatterns
###############################################################################


urlpatterns: list[Any] = [
    path(
        "custom-functions/<int:function_id>/webhook/",
        custom_function_webhook,
        name="custom-function-webhook",
    ),
    *router.urls,
]

