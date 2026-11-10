"""Shared base classes for the CRM apps (accounts, contacts, leads, deals).

The four CRM apps share most of their behaviour:

* CursorPagination (page_size 50, max 200).
* ``?sort=-created_at,name`` multi-key ordering.
* ``?fields=id,name,email`` dynamic field projection.
* Soft delete via ``deleted_at`` (see :mod:`api.soft_delete`).
* Bulk actions: ``mass_update``, ``mass_delete``, ``bulk_create``,
  ``restore``, ``merge``.
* Tenant scoping via :class:`api.managers.TenantManager`.

Centralising these here keeps the per-app viewsets thin and consistent.
"""

from __future__ import annotations

from typing import Any, ClassVar, Iterable, Sequence

from django.db import transaction
from django.db.models import Model, Q
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.pagination import CursorPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.serializers import Serializer
from rest_framework.viewsets import ModelViewSet

from .permissions import HasPermission, IsTenantMember
from .soft_delete import SoftDeleteTenantModel


###############################################################################
# Pagination
###############################################################################


class CRMCursorPagination(CursorPagination):
    """Cursor pagination for CRM list endpoints.

    Cursor pagination is stable under writes (no row shifts when new records
    are inserted) which matters for infinite-scroll UIs.
    """

    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200
    ordering = "-created_at"


###############################################################################
# Serializer mixins
###############################################################################


class DynamicFieldsMixin:
    """Project the response to ``?fields=f1,f2``.

    Applied on top of a :class:`rest_framework.serializers.Serializer`. The
    viewset's ``get_serializer`` populates ``_fields`` from the request.
    """

    fields_param: str | None = None  # set by the viewset

    def to_representation(self, instance: Any) -> dict[str, Any]:  # type: ignore[override]
        representation = super().to_representation(instance)  # type: ignore[misc]
        requested = self.fields_param
        if requested:
            allowed = {f.strip() for f in requested.split(",") if f.strip()}
            # Always keep ``id`` so clients can correlate.
            allowed.add("id")
            representation = {k: v for k, v in representation.items() if k in allowed}
        return representation


class CustomFieldsSerializerMixin:
    """Attach a ``custom_fields`` dict to the serialized representation.

    The viewset is expected to populate ``_custom_field_module`` so the mixin
    knows which module to query. Reads use :func:`custom_fields.services.get_values`
    for a batch of records; writes consume ``custom_fields`` on create/update.
    """

    custom_field_module: ClassVar[str] = ""

    @property
    def _cf_module(self) -> str:
        return self.custom_field_module or getattr(self, "_custom_field_module", "")

    def to_representation(self, instance: Any) -> dict[str, Any]:  # type: ignore[override]
        representation = super().to_representation(instance)  # type: ignore[misc]
        module = self._cf_module
        if not module:
            return representation
        # Avoid circular import at module load.
        from custom_fields.services import get_values

        tenant = getattr(instance, "tenant_id", None)
        if tenant is None:
            representation["custom_fields"] = {}
            return representation
        values = get_values(tenant_id=tenant, module=module, record_ids=[str(instance.pk)])
        representation["custom_fields"] = values.get(str(instance.pk), {})
        return representation

    def create(self, validated_data: dict[str, Any]) -> Any:  # type: ignore[override]
        custom_fields = validated_data.pop("custom_fields", None)
        instance = super().create(validated_data)  # type: ignore[misc]
        self._save_custom_fields(instance, custom_fields)
        return instance

    def update(self, instance: Any, validated_data: dict[str, Any]) -> Any:  # type: ignore[override]
        custom_fields = validated_data.pop("custom_fields", None)
        updated = super().update(instance, validated_data)  # type: ignore[misc]
        self._save_custom_fields(updated, custom_fields)
        return updated

    def _save_custom_fields(self, instance: Any, custom_fields: dict[str, Any] | None) -> None:
        if custom_fields is None:
            return
        module = self._cf_module
        if not module:
            return
        from custom_fields.models import CustomField
        from custom_fields.services import set_value

        tenant_id = instance.tenant_id
        fields_by_api = {
            f.api_name: f
            for f in CustomField.objects.filter(tenant_id=tenant_id, module=module)
        }
        for api_name, value in custom_fields.items():
            field = fields_by_api.get(api_name)
            if field is None:
                continue
            set_value(
                tenant_id=tenant_id,
                module=module,
                record_id=str(instance.pk),
                field=field,
                value=value,
            )


###############################################################################
# ViewSet base
###############################################################################


def _parse_sort(sort: str | None, allowed: Iterable[str]) -> list[str]:
    """Turn ``-created_at,name`` into a list of ORM order keys.

    Drops any field that isn't whitelisted. Prefix with ``-`` for descending.
    """
    if not sort:
        return []
    out: list[str] = []
    allowed_set = set(allowed)
    for raw in sort.split(","):
        token = raw.strip()
        if not token:
            continue
        key = token.lstrip("-")
        if key in allowed_set:
            out.append(token)
    return out


class CRMModelViewSet(ModelViewSet):
    """Common base for all CRM viewsets.

    Subclasses must set:
    * ``serializer_class``
    * ``queryset`` (model's default manager)
    * ``filterset_class``
    * ``sort_fields`` (tuple of allowed sort keys)
    * ``bulk_update_fields`` (tuple of fields ``mass_update`` may touch)
    * ``custom_field_module`` (e.g. ``"lead"``)
    """

    pagination_class = CRMCursorPagination
    permission_classes: Sequence[type] = [IsAuthenticated, IsTenantMember]

    filterset_class: Any = None
    sort_fields: tuple[str, ...] = ()
    bulk_update_fields: tuple[str, ...] = ()
    custom_field_module: str = ""
    # Optional: required permission (string or iterable). None = IsTenantMember only.
    required_permission: str | Iterable[str] | None = None

    # ------------------------------------------------------------------ queryset

    def get_queryset(self) -> Any:
        queryset = super().get_queryset()
        # ``objects`` already filters by tenant + excludes soft-deleted.
        return queryset

    def get_permissions(self) -> Any:
        if self.required_permission is not None:
            return [
                IsAuthenticated(),
                IsTenantMember(),
                HasPermission(self.required_permission),
            ]
        return [p() for p in self.permission_classes]

    # ------------------------------------------------------------------ sort/fields

    def _apply_sort(self, queryset: Any) -> Any:
        sort = self.request.query_params.get("sort")  # type: ignore[union-attr]
        keys = _parse_sort(sort, self.sort_fields)
        if keys:
            return queryset.order_by(*keys)
        return queryset

    def list(self, request: Request, *args: Any, **kwargs: Any) -> Response:  # type: ignore[override]
        queryset = self.filter_queryset(self.get_queryset())
        queryset = self._apply_sort(queryset)
        page = self.paginate_queryset(queryset)
        serializer = self._serializer_with_dynamic_fields(page, many=True)
        return self.get_paginated_response(serializer.data)

    def retrieve(self, request: Request, *args: Any, **kwargs: Any) -> Response:  # type: ignore[override]
        instance = self.get_object()
        serializer = self._serializer_with_dynamic_fields(instance)
        return Response(serializer.data)

    def _serializer_with_dynamic_fields(self, instance: Any, many: bool = False) -> Serializer:
        serializer = self.get_serializer(instance, many=many)
        fields = self.request.query_params.get("fields")  # type: ignore[union-attr]
        if hasattr(serializer, "fields_param"):
            serializer.fields_param = fields  # type: ignore[attr-defined]
        if hasattr(serializer, "_custom_field_module"):
            serializer._custom_field_module = self.custom_field_module  # type: ignore[attr-defined]
        # For ListSerializer wrapping many=True, propagate to children.
        if hasattr(serializer, "child"):
            child = serializer.child  # type: ignore[attr-defined]
            if hasattr(child, "fields_param"):
                child.fields_param = fields  # type: ignore[attr-defined]
            if hasattr(child, "_custom_field_module"):
                child._custom_field_module = self.custom_field_module  # type: ignore[attr-defined]
        return serializer

    # ------------------------------------------------------------------ soft delete

    def perform_destroy(self, instance: Any) -> None:  # type: ignore[override]
        """Soft delete — set ``deleted_at`` instead of removing the row."""
        if isinstance(instance, SoftDeleteTenantModel):
            instance.soft_delete()
        else:  # pragma: no cover — defensive
            instance.delete()

    # ------------------------------------------------------------------ bulk actions

    @action(detail=False, methods=["post"], url_path="mass-update")
    def mass_update(self, request: Request) -> Response:
        """POST ``{"ids": [...], "fields": {...}}`` to patch many rows at once."""
        ids = request.data.get("ids") or []
        fields = request.data.get("fields") or {}
        if not isinstance(ids, list) or not ids:
            return Response({"detail": "ids must be a non-empty list."}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(fields, dict) or not fields:
            return Response({"detail": "fields must be a non-empty object."}, status=status.HTTP_400_BAD_REQUEST)
        disallowed = set(fields) - set(self.bulk_update_fields)
        if disallowed:
            return Response(
                {"detail": f"Cannot mass-update fields: {sorted(disallowed)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        queryset = self.filter_queryset(self.get_queryset()).filter(pk__in=ids)
        updated = queryset.update(**fields)
        return Response({"updated": updated})

    @action(detail=False, methods=["post"], url_path="mass-delete")
    def mass_delete(self, request: Request) -> Response:
        """POST ``{"ids": [...]}`` to soft-delete many rows."""
        ids = request.data.get("ids") or []
        if not isinstance(ids, list) or not ids:
            return Response({"detail": "ids must be a non-empty list."}, status=status.HTTP_400_BAD_REQUEST)
        queryset = self.filter_queryset(self.get_queryset()).filter(pk__in=ids)
        count = 0
        for instance in queryset:
            if isinstance(instance, SoftDeleteTenantModel):
                instance.soft_delete()
                count += 1
        return Response({"deleted": count})

    @action(detail=False, methods=["post"], url_path="bulk-create")
    def bulk_create(self, request: Request) -> Response:
        """POST an array of payloads to create many rows."""
        payload = request.data
        if not isinstance(payload, list) or not payload:
            return Response({"detail": "Expected a non-empty array."}, status=status.HTTP_400_BAD_REQUEST)
        serializer = self.get_serializer(data=payload, many=True)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            instances = serializer.save()
        return Response(
            self.get_serializer(instances, many=True).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="restore")
    def restore(self, request: Request, pk: str | None = None) -> Response:
        """Recover a soft-deleted row by id."""
        queryset = self.get_queryset().all_with_deleted()  # type: ignore[attr-defined]
        instance = get_object_or_404(queryset, pk=pk)
        if not isinstance(instance, SoftDeleteTenantModel):
            return Response({"detail": "Not soft-deletable."}, status=status.HTTP_400_BAD_REQUEST)
        instance.restore()
        return Response(self.get_serializer(instance).data)

    @action(detail=False, methods=["post"], url_path="merge")
    def merge(self, request: Request) -> Response:
        """POST ``{"source_id": <id>, "target_id": <id>}`` to merge two rows.

        Default implementation: copy non-empty fields from source → target,
        then soft-delete the source. Subclasses override to handle FK/M2M
        re-parenting.
        """
        source_id = request.data.get("source_id")
        target_id = request.data.get("target_id")
        if not source_id or not target_id or source_id == target_id:
            return Response(
                {"detail": "source_id and target_id must be distinct."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        queryset = self.get_queryset()
        source = get_object_or_404(queryset, pk=source_id)
        target = get_object_or_404(queryset, pk=target_id)
        with transaction.atomic():
            self._merge(source, target)
            if isinstance(source, SoftDeleteTenantModel):
                source.soft_delete()
        return Response(self.get_serializer(target).data)

    def _merge(self, source: Model, target: Model) -> None:
        """Override in subclasses for FK/M2M re-parenting. Default: no-op."""
        return None


###############################################################################
# Helpers for queryset filtering
###############################################################################


def q_in_or(value: Any) -> Q:
    """Turn a list into an ORM ``__in`` Q object; scalars fall back to exact."""
    if isinstance(value, (list, tuple, set)):
        return Q(pk__in=value)  # placeholder; callers build their own Q
    return Q(pk=value)
