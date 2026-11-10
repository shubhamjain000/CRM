"""DRF ViewSets for the marketplace app.

* :class:`ExtensionViewSet` — read-only list / retrieve + ``install``
  (POST) + ``uninstall`` (POST). Reads are open to any authenticated
  tenant member because the catalog is global.
* :class:`InstalledExtensionViewSet` — CRUD on the tenant's installed
  extensions.
"""

from __future__ import annotations

from typing import Any

from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet, ReadOnlyModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember

from .models import Extension, InstalledExtension, STATUS_ACTIVE
from .serializers import ExtensionSerializer, InstalledExtensionSerializer


class ExtensionViewSet(ReadOnlyModelViewSet):
    """List / retrieve Extension catalog rows + ``install`` / ``uninstall``."""

    pagination_class = CRMCursorPagination
    serializer_class = ExtensionSerializer
    queryset = Extension.objects.all()

    def get_permissions(self) -> Any:
        if self.action in ("list", "retrieve"):
            return [IsAuthenticated(), IsTenantMember()]
        return [
            IsAuthenticated(),
            IsTenantMember(),
            HasPermission("marketplace.manage"),
        ]

    @action(detail=True, methods=["post"], url_path="install")
    def install(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{config?}`` — install this extension for the caller's tenant."""
        extension: Extension = self.get_object()  # type: ignore[assignment]
        install_row, created = InstalledExtension.objects.get_or_create(
            tenant=request.tenant,
            extension=extension,
            defaults={
                "config": request.data.get("config", {}) or {},
                "status": STATUS_ACTIVE,
            },
        )
        if not created:
            install_row.status = STATUS_ACTIVE
            install_row.last_synced_at = timezone.now()
            install_row.save(update_fields=["status", "last_synced_at", "updated_at"])
        # Bump download counter on first install.
        if created:
            Extension.objects.filter(pk=extension.pk).update(
                downloads=extension.downloads + 1
            )
        return Response(
            InstalledExtensionSerializer(install_row).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="uninstall")
    def uninstall(self, request: Request, pk: str | None = None) -> Response:
        """POST — remove this extension from the caller's tenant."""
        extension: Extension = self.get_object()  # type: ignore[assignment]
        deleted, _ = InstalledExtension.objects.filter(
            tenant=request.tenant, extension=extension
        ).delete()
        if not deleted:
            return Response(
                {"detail": "Extension is not installed for this tenant."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response({"uninstalled": True}, status=status.HTTP_200_OK)


class InstalledExtensionViewSet(ModelViewSet):
    """CRUD on the caller tenant's installed extensions."""

    pagination_class = CRMCursorPagination
    serializer_class = InstalledExtensionSerializer
    queryset = InstalledExtension.objects.select_related("tenant", "extension")

    def get_permissions(self) -> Any:
        if self.action in ("list", "retrieve"):
            return [IsAuthenticated(), IsTenantMember()]
        return [
            IsAuthenticated(),
            IsTenantMember(),
            HasPermission("marketplace.manage"),
        ]

    def perform_create(  # type: ignore[override]
        self, serializer: InstalledExtensionSerializer
    ) -> None:
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


__all__ = ["ExtensionViewSet", "InstalledExtensionViewSet"]
