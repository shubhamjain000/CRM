"""DRF viewsets for the custom_fields app."""

from __future__ import annotations

from typing import Any, Iterable

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember
from custom_fields.models import CustomField, CustomFieldValue
from custom_fields.serializers import (
    CustomFieldDefinitionSerializer,
    CustomFieldSerializer,
    CustomFieldValueSerializer,
)
from custom_fields.services import (
    get_custom_fields,
    get_values,
    set_value,
)


class CustomFieldViewSet(ModelViewSet):
    """CRUD for custom field definitions."""

    pagination_class = CRMCursorPagination
    serializer_class = CustomFieldSerializer
    permission_classes = [IsAuthenticated, IsTenantMember]

    def get_queryset(self) -> Any:
        return CustomField.objects.all()

    def get_serializer_context(self) -> dict[str, Any]:
        ctx = super().get_serializer_context()
        tenant = getattr(self.request, "tenant", None)  # type: ignore[attr-defined]
        if tenant is not None:
            ctx["tenant_id"] = tenant.pk
        return ctx

    def get_permissions(self) -> Any:
        method = self.request.method or ""
        if method in ("GET", "HEAD", "OPTIONS"):
            perm: Iterable[str] | str = "crm.custom_fields.read"
        elif method == "POST":
            perm = "crm.custom_fields.create"
        elif method in ("PUT", "PATCH"):
            perm = "crm.custom_fields.update"
        elif method == "DELETE":
            perm = "crm.custom_fields.delete"
        else:
            return super().get_permissions()
        return [IsAuthenticated(), IsTenantMember(), HasPermission(perm)]

    @action(detail=False, methods=["get"], url_path="schema")
    def schema(self, request: Request) -> Response:
        """Return the field definitions for ``?module=lead`` as a list."""
        module = request.query_params.get("module")
        if not module:
            return Response(
                {"detail": "module query param is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        tenant_id = request.tenant.pk  # type: ignore[attr-defined]
        fields = get_custom_fields(tenant_id=tenant_id, module=module)
        return Response(CustomFieldDefinitionSerializer(fields, many=True).data)


class CustomFieldValueViewSet(ModelViewSet):
    """CRUD for individual custom field values (low-level API)."""

    pagination_class = CRMCursorPagination
    serializer_class = CustomFieldValueSerializer
    permission_classes = [IsAuthenticated, IsTenantMember]

    def get_queryset(self) -> Any:
        return CustomFieldValue.objects.all()

    def create(self, request: Request, *args: Any, **kwargs: Any) -> Response:  # type: ignore[override]
        """POST ``{field, module, record_id, value}`` — validates + upserts."""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            field = CustomField.objects.get(pk=serializer.validated_data["field"].pk)
        except CustomField.DoesNotExist:
            return Response({"detail": "Unknown field."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            obj = set_value(
                tenant_id=request.tenant.pk,  # type: ignore[attr-defined]
                module=serializer.validated_data["module"],
                record_id=serializer.validated_data["record_id"],
                field=field,
                value=serializer.validated_data["value"],
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(CustomFieldValueSerializer(obj).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"], url_path="batch")
    def batch(self, request: Request) -> Response:
        """GET ``?module=lead&record_ids=1,2,3`` to bulk-read values."""
        module = request.query_params.get("module")
        record_ids = request.query_params.get("record_ids", "")
        if not module or not record_ids:
            return Response(
                {"detail": "module and record_ids are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        ids = [r.strip() for r in record_ids.split(",") if r.strip()]
        values = get_values(tenant_id=request.tenant.pk, module=module, record_ids=ids)  # type: ignore[attr-defined]
        return Response(values)
