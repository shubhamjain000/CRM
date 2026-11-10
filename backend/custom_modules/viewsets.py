"""DRF ViewSets for the custom_modules app.

* :class:`CustomModuleViewSet` — CRUD + ``clone``.
* :class:`CustomModuleFieldViewSet` — CRUD.
* :class:`CustomModuleRecordViewSet` — CRUD (validates ``data`` against
  the module's field schema on create / update).
"""

from __future__ import annotations

from typing import Any

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember

from .filters import (
    CustomModuleFieldFilter,
    CustomModuleFilter,
    CustomModuleRecordFilter,
)
from .models import CustomModule, CustomModuleField, CustomModuleRecord
from .serializers import (
    CustomModuleFieldSerializer,
    CustomModuleRecordSerializer,
    CustomModuleSerializer,
)
from .services import clone_module, validate_record_data


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve"):
        return [IsAuthenticated(), IsTenantMember()]
    return [IsAuthenticated(), IsTenantMember(), HasPermission("custom_modules.manage")]


###############################################################################
# CustomModuleViewSet
###############################################################################


class CustomModuleViewSet(ModelViewSet):
    """CRUD + ``clone`` on :class:`CustomModule`."""

    pagination_class = CRMCursorPagination
    serializer_class = CustomModuleSerializer
    filterset_class = CustomModuleFilter
    queryset = (
        CustomModule.objects.select_related("tenant")
        .prefetch_related("fields")
        .all()
    )

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: CustomModuleSerializer
    ) -> None:
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant
        )

    @action(detail=True, methods=["post"], url_path="clone")
    def clone(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{name?}`` — deep-copy this module + its field schema."""
        module: CustomModule = self.get_object()  # type: ignore[assignment]
        new_name = (request.data or {}).get("name")
        clone = clone_module(module, new_name=new_name)
        return Response(
            CustomModuleSerializer(clone).data, status=status.HTTP_201_CREATED
        )


###############################################################################
# CustomModuleFieldViewSet
###############################################################################


class CustomModuleFieldViewSet(ModelViewSet):
    """CRUD on :class:`CustomModuleField`."""

    pagination_class = CRMCursorPagination
    serializer_class = CustomModuleFieldSerializer
    filterset_class = CustomModuleFieldFilter
    queryset = CustomModuleField.objects.select_related("tenant", "module").all()

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: CustomModuleFieldSerializer
    ) -> None:
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant
        )


###############################################################################
# CustomModuleRecordViewSet
###############################################################################


class CustomModuleRecordViewSet(ModelViewSet):
    """CRUD on :class:`CustomModuleRecord`."""

    pagination_class = CRMCursorPagination
    serializer_class = CustomModuleRecordSerializer
    filterset_class = CustomModuleRecordFilter
    queryset = CustomModuleRecord.objects.select_related("tenant", "module").all()

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: CustomModuleRecordSerializer
    ) -> None:
        module = serializer.validated_data["module"]
        try:
            data = validate_record_data(module, serializer.validated_data.get("data", {}))
        except DjangoValidationError as exc:
            return Response(  # type: ignore[return-value]
                {"detail": exc.message_dict if hasattr(exc, "message_dict") else str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant, data=data
        )

    def perform_update(  # type: ignore[override]
        self, serializer: CustomModuleRecordSerializer
    ) -> None:
        record: CustomModuleRecord = serializer.instance  # type: ignore[assignment]
        module = serializer.validated_data.get("module", record.module)
        try:
            data = validate_record_data(
                module, serializer.validated_data.get("data", record.data)
            )
        except DjangoValidationError as exc:
            return Response(  # type: ignore[return-value]
                {"detail": exc.message_dict if hasattr(exc, "message_dict") else str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer.save(data=data)  # type: ignore[attr-defined]


__all__ = [
    "CustomModuleFieldViewSet",
    "CustomModuleRecordViewSet",
    "CustomModuleViewSet",
]
