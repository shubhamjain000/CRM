"""DRF ViewSets for the canvas app.

* :class:`CanvasThemeViewSet` — singleton get/update + ``templates`` +
  ``preview``.
"""

from __future__ import annotations

from typing import Any

from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ViewSet

from api.permissions import HasPermission, IsTenantMember

from .serializers import CanvasThemeSerializer
from .services import (
    get_prebuilt_templates,
    get_theme_for_tenant,
    preview_theme,
)


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve", "templates", "preview"):
        return [IsAuthenticated(), IsTenantMember()]
    return [IsAuthenticated(), IsTenantMember(), HasPermission("canvas.manage")]


###############################################################################
# CanvasThemeViewSet
###############################################################################


class CanvasThemeViewSet(ViewSet):
    """Singleton per-tenant theme — get / patch + ``templates`` + ``preview``.

    This is intentionally a ``ViewSet`` (not ``ModelViewSet``) because
    there is only ever one row per tenant; the conventional CRUD
    surface (POST to create, DELETE to remove) does not apply. The
    ``list`` and ``retrieve`` actions both return the singleton.
    """

    serializer_class = CanvasThemeSerializer

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def list(self, request: Request) -> Response:
        theme = get_theme_for_tenant(request.tenant)
        return Response(CanvasThemeSerializer(theme).data)

    def retrieve(self, request: Request, pk: str | None = None) -> Response:
        # ``pk`` is ignored — there is exactly one theme per tenant.
        theme = get_theme_for_tenant(request.tenant)
        return Response(CanvasThemeSerializer(theme).data)

    def partial_update(
        self, request: Request, pk: str | None = None
    ) -> Response:
        theme = get_theme_for_tenant(request.tenant)
        serializer = CanvasThemeSerializer(theme, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def update(
        self, request: Request, pk: str | None = None
    ) -> Response:
        theme = get_theme_for_tenant(request.tenant)
        serializer = CanvasThemeSerializer(theme, data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    @action(detail=False, methods=["get"], url_path="templates")
    def templates(self, request: Request) -> Response:
        """GET — return the 5 pre-built theme templates."""
        return Response({"templates": get_prebuilt_templates()})

    @action(detail=False, methods=["post"], url_path="preview")
    def preview(self, request: Request) -> Response:
        """POST ``{overrides?}`` — return merged values + computed CSS."""
        theme = get_theme_for_tenant(request.tenant)
        overrides = request.data if isinstance(request.data, dict) else None
        return Response(preview_theme(theme, overrides))


__all__ = ["CanvasThemeViewSet"]
