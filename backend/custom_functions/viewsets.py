"""DRF ViewSets for the custom_functions app.

:class:`CustomFunctionViewSet` — CRUD on :class:`CustomFunction` plus the
``execute`` / ``history`` / ``metrics`` / ``templates`` / ``approve`` /
``versions`` / ``restore_version`` / ``export_json`` / ``import_json`` /
``test`` actions.

:class:`CustomFunctionExecutionViewSet` — read-only list / retrieve.

:class:`HttpAllowlistViewSet` — CRUD on :class:`HttpAllowlist` (admin-only
writes).

:class:`KVStoreViewSet` — per-tenant KV store with ``get`` / ``set`` /
``delete`` actions.

:class:`HttpCallLogViewSet` — read-only list / retrieve.
"""

from __future__ import annotations

from typing import Any

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet, ReadOnlyModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsOrgAdmin, IsTenantMember
from custom_functions.filters import (
    CustomFunctionExecutionFilter,
    CustomFunctionFilter,
    HttpAllowlistFilter,
    HttpCallLogFilter,
    KVStoreFilter,
)
from custom_functions.models import (
    CustomFunction,
    CustomFunctionExecution,
    CustomFunctionVersion,
    HttpAllowlist,
    HttpCallLog,
    KVStore,
    TRIGGER_MANUAL,
)
from custom_functions.sandbox import execute_code
from custom_functions.serializers import (
    CustomFunctionExecutionSerializer,
    CustomFunctionSerializer,
    CustomFunctionVersionSerializer,
    HttpAllowlistSerializer,
    HttpCallLogSerializer,
    KVStoreSerializer,
)
from custom_functions.services import (
    CustomFunctionService,
    kv_delete,
    kv_get,
    kv_set,
)


###############################################################################
# CustomFunctionViewSet
###############################################################################


class CustomFunctionViewSet(ModelViewSet):
    """CRUD + lifecycle / execute / metrics / templates actions.

    Writes (create / update / destroy / approve / restore_version /
    import_json) require the ``custom_functions.manage`` permission.
    The ``approve`` action additionally requires org admin.

    The ``execute`` and ``test`` actions bypass the approval gate for
    manual / test runs so authors can iterate; production triggers
    (``webhook`` / ``workflow`` / ``scheduled`` / ``api``) raise
    ``PermissionError`` from the service unless ``is_approved=True``.
    """

    pagination_class = CRMCursorPagination
    serializer_class = CustomFunctionSerializer
    filterset_class = CustomFunctionFilter
    queryset = CustomFunction.objects.select_related("tenant", "created_by")

    def get_permissions(self) -> Any:
        if self.action in (
            "list",
            "retrieve",
            "execute",
            "history",
            "metrics",
            "templates",
            "versions",
            "export_json",
            "test",
        ):
            return [IsAuthenticated(), IsTenantMember()]
        if self.action == "approve":
            return [IsAuthenticated(), IsTenantMember(), IsOrgAdmin()]
        return [
            IsAuthenticated(),
            IsTenantMember(),
            HasPermission("custom_functions.manage"),
        ]

    def get_queryset(self) -> Any:
        qs = super().get_queryset()
        params = self.request.query_params
        language = params.get("language")
        if language:
            qs = qs.filter(language=language)
        trigger_event = params.get("trigger_event")
        if trigger_event:
            qs = qs.filter(trigger_event=trigger_event)
        is_active = params.get("is_active")
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() in ("true", "1"))
        is_approved = params.get("is_approved")
        if is_approved is not None:
            qs = qs.filter(is_approved=is_approved.lower() in ("true", "1"))
        return qs

    def perform_create(self, serializer: CustomFunctionSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant, created_by=self.request.user)  # type: ignore[attr-defined]

    def perform_update(self, serializer: CustomFunctionSerializer) -> None:  # type: ignore[override]
        # Snapshot the existing code as a version before the update lands.
        instance: CustomFunction = serializer.instance  # type: ignore[assignment]
        if instance is not None:
            CustomFunctionService().save_version(instance, self.request.user)
        serializer.save()

    # ------------------------------------------------------------------ execute / test

    @action(detail=True, methods=["post"], url_path="execute")
    def execute(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{input_data: ...}`` → run the function synchronously.

        Returns the :class:`CustomFunctionExecution` row (status + output +
        logs). Trigger defaults to ``manual`` (which bypasses the approval
        gate); pass ``{"trigger": "webhook"}`` etc. to exercise the gate.
        """
        function: CustomFunction = self.get_object()  # type: ignore[assignment]
        trigger = request.data.get("trigger") or TRIGGER_MANUAL
        input_data = request.data.get("input_data")
        try:
            execution = CustomFunctionService().execute(
                function_id=function.pk,
                input_data=input_data,
                trigger=trigger,
                user=request.user,
            )
        except (ValueError, PermissionError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(CustomFunctionExecutionSerializer(execution).data)

    @action(detail=False, methods=["post"], url_path="test")
    def test(self, request: Request) -> Response:
        """POST ``{code, language, input_data}`` → execute without saving.

        Useful for authoring / debugging. No :class:`CustomFunction` row is
        created; the result is returned directly. No approval gate.
        """
        code = request.data.get("code") or ""
        language = request.data.get("language") or "python"
        input_data = request.data.get("input_data")
        if not code:
            return Response(
                {"detail": "code is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        result = execute_code(
            code=code,
            language=language,
            input_data=input_data,
            context={
                "tenant_id": request.tenant.pk,  # type: ignore[attr-defined]
                "user_id": request.user.pk,
            },
        )
        return Response(result.to_dict())

    # ------------------------------------------------------------------ history / metrics / templates

    @action(detail=True, methods=["get"], url_path="history")
    def history(self, request: Request, pk: str | None = None) -> Response:
        function: CustomFunction = self.get_object()  # type: ignore[assignment]
        qs = CustomFunctionExecution.objects.filter(function=function).order_by(
            "-started_at"
        )
        page = self.paginate_queryset(qs)
        serializer = CustomFunctionExecutionSerializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    @action(detail=True, methods=["get"], url_path="metrics")
    def metrics(self, request: Request, pk: str | None = None) -> Response:
        function: CustomFunction = self.get_object()  # type: ignore[assignment]
        return Response(CustomFunctionService().get_metrics(function.pk))

    @action(detail=False, methods=["get"], url_path="templates")
    def templates(self, request: Request) -> Response:
        return Response(CustomFunctionService().get_templates())

    # ------------------------------------------------------------------ approve

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request: Request, pk: str | None = None) -> Response:
        """Toggle admin approval on a function (admin-only)."""
        function: CustomFunction = self.get_object()  # type: ignore[assignment]
        value = request.data.get("is_approved")
        function.is_approved = bool(value) if value is not None else True
        function.save(update_fields=["is_approved", "updated_at"])
        return Response(self.get_serializer(function).data)

    # ------------------------------------------------------------------ versions

    @action(detail=True, methods=["get"], url_path="versions")
    def versions(self, request: Request, pk: str | None = None) -> Response:
        function: CustomFunction = self.get_object()  # type: ignore[assignment]
        qs = CustomFunctionVersion.objects.filter(function=function).order_by(
            "-version"
        )
        page = self.paginate_queryset(qs)
        serializer = CustomFunctionVersionSerializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    @action(
        detail=True,
        methods=["post"],
        url_path="restore-version",
    )
    def restore_version(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{version: <int>}`` → roll ``function.code`` back to that version."""
        function: CustomFunction = self.get_object()  # type: ignore[assignment]
        version = request.data.get("version")
        if version is None:
            return Response(
                {"detail": "version is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            updated = CustomFunctionService().restore_version(
                function, int(version), request.user
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)
        return Response(self.get_serializer(updated).data)

    # ------------------------------------------------------------------ export / import

    @action(detail=True, methods=["get"], url_path="export-json")
    def export_json(self, request: Request, pk: str | None = None) -> Response:
        function: CustomFunction = self.get_object()  # type: ignore[assignment]
        return Response(CustomFunctionService().export_json(function))

    @action(detail=False, methods=["post"], url_path="import-json")
    def import_json(self, request: Request) -> Response:
        payload = request.data
        try:
            function = CustomFunctionService().import_json(
                payload, request.tenant, request.user  # type: ignore[attr-defined]
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            self.get_serializer(function).data, status=status.HTTP_201_CREATED
        )


###############################################################################
# CustomFunctionExecutionViewSet
###############################################################################


class CustomFunctionExecutionViewSet(ReadOnlyModelViewSet):
    """Read-only list / retrieve for :class:`CustomFunctionExecution`."""

    pagination_class = CRMCursorPagination
    serializer_class = CustomFunctionExecutionSerializer
    filterset_class = CustomFunctionExecutionFilter
    permission_classes = [IsAuthenticated, IsTenantMember]
    queryset = CustomFunctionExecution.objects.select_related("function", "tenant")


###############################################################################
# HttpAllowlistViewSet
###############################################################################


class HttpAllowlistViewSet(ModelViewSet):
    """CRUD on :class:`HttpAllowlist`. Writes require org admin."""

    pagination_class = CRMCursorPagination
    serializer_class = HttpAllowlistSerializer
    filterset_class = HttpAllowlistFilter
    queryset = HttpAllowlist.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        if self.action in ("list", "retrieve"):
            return [IsAuthenticated(), IsTenantMember()]
        return [IsAuthenticated(), IsTenantMember(), IsOrgAdmin()]

    def perform_create(self, serializer: HttpAllowlistSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


###############################################################################
# HttpCallLogViewSet
###############################################################################


class HttpCallLogViewSet(ReadOnlyModelViewSet):
    """Read-only list / retrieve for :class:`HttpCallLog`."""

    pagination_class = CRMCursorPagination
    serializer_class = HttpCallLogSerializer
    filterset_class = HttpCallLogFilter
    permission_classes = [IsAuthenticated, IsTenantMember]
    queryset = HttpCallLog.objects.select_related("tenant", "function_execution")


###############################################################################
# KVStoreViewSet
###############################################################################


class KVStoreViewSet(ModelViewSet):
    """Per-tenant KV store exposed to the API.

    The standard CRUD endpoints are available plus convenience ``get`` /
    ``set`` / ``delete`` actions that operate on a single key.
    """

    pagination_class = CRMCursorPagination
    serializer_class = KVStoreSerializer
    filterset_class = KVStoreFilter
    permission_classes = [IsAuthenticated, IsTenantMember]
    queryset = KVStore.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        if self.action in ("list", "retrieve", "get", "set"):
            return [IsAuthenticated(), IsTenantMember()]
        return [
            IsAuthenticated(),
            IsTenantMember(),
            HasPermission("custom_functions.manage"),
        ]

    def perform_create(self, serializer: KVStoreSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    @action(detail=False, methods=["get"], url_path="get")
    def get_value(self, request: Request) -> Response:
        """GET ``?key=<key>`` → ``{value: str | null}``."""
        key = request.query_params.get("key")
        if not key:
            return Response(
                {"detail": "key query param is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({"key": key, "value": kv_get(request.tenant.pk, key)})  # type: ignore[attr-defined]

    @action(detail=False, methods=["post"], url_path="set")
    def set_value(self, request: Request) -> Response:
        """POST ``{key, value}`` → upsert."""
        key = request.data.get("key")
        value = request.data.get("value")
        if not key:
            return Response(
                {"detail": "key is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        entry = kv_set(
            request.tenant.pk,  # type: ignore[attr-defined]
            str(key),
            value if isinstance(value, str) else str(value),
        )
        return Response(KVStoreSerializer(entry).data)

    @action(detail=False, methods=["post"], url_path="delete")
    def delete_value(self, request: Request) -> Response:
        """POST ``{key}`` → bool."""
        key = request.data.get("key")
        if not key:
            return Response(
                {"detail": "key is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({"deleted": kv_delete(request.tenant.pk, str(key))})  # type: ignore[attr-defined]


__all__ = [
    "CustomFunctionExecutionViewSet",
    "CustomFunctionViewSet",
    "HttpAllowlistViewSet",
    "HttpCallLogViewSet",
    "KVStoreViewSet",
]
