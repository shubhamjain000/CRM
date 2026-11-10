"""DRF ViewSets for the forecasting app.

* :class:`ForecastViewSet` — CRUD + ``calculate`` / ``submit`` /
  ``approve`` / ``roll_up`` / ``accuracy`` / ``scenarios``.
* :class:`ForecastAdjustmentViewSet` — list / retrieve (append-only).
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember

from .filters import ForecastAdjustmentFilter, ForecastFilter
from .models import CATEGORY_PIPELINE, Forecast, ForecastAdjustment, PERIOD_MONTHLY
from .serializers import ForecastAdjustmentSerializer, ForecastSerializer
from .services import (
    apply_override,
    approve_forecast,
    get_accuracy,
    get_or_create_forecast,
    get_scenarios,
    roll_up,
    submit_forecast,
)


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in (
        "list", "retrieve", "calculate", "roll_up", "accuracy", "scenarios",
    ):
        return [IsAuthenticated(), IsTenantMember()]
    return [IsAuthenticated(), IsTenantMember(), HasPermission("forecasting.manage")]


###############################################################################
# ForecastViewSet
###############################################################################


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    return date.fromisoformat(value)


class ForecastViewSet(ModelViewSet):
    """CRUD + lifecycle actions on :class:`Forecast`."""

    pagination_class = CRMCursorPagination
    serializer_class = ForecastSerializer
    filterset_class = ForecastFilter
    queryset = Forecast.objects.select_related("tenant", "user", "approved_by")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: ForecastSerializer
    ) -> None:
        user = serializer.validated_data.get("user") or self.request.user
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant, user=user
        )

    @action(detail=False, methods=["post"], url_path="calculate")
    def calculate(self, request: Request) -> Response:
        """POST ``{user_id?, period_type, period_start, category?}`` —
        auto-calculate the forecast amount from open deals and create /
        update the :class:`Forecast` row.
        """
        period_type = request.data.get("period_type", PERIOD_MONTHLY)
        period_start = _parse_date(request.data.get("period_start"))
        if period_start is None:
            return Response(
                {"detail": "period_start (YYYY-MM-DD) is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        category = request.data.get("category", CATEGORY_PIPELINE)
        user_id = request.data.get("user_id")
        from api.models import User  # noqa: PLC0415

        target_user = (
            User.objects.filter(pk=user_id).first() if user_id else request.user
        )
        if target_user is None:
            return Response(
                {"detail": "Unknown user_id."}, status=status.HTTP_400_BAD_REQUEST
            )
        forecast = get_or_create_forecast(
            tenant=request.tenant,
            user=target_user,
            period_type=period_type,
            period_start=period_start,
            category=category,
        )
        return Response(ForecastSerializer(forecast).data)

    @action(detail=True, methods=["post"], url_path="submit")
    def submit(self, request: Request, pk: str | None = None) -> Response:
        """POST — mark the forecast as submitted."""
        forecast: Forecast = self.get_object()  # type: ignore[assignment]
        submit_forecast(forecast)
        return Response(ForecastSerializer(forecast).data)

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request: Request, pk: str | None = None) -> Response:
        """POST — approve the forecast (caller becomes ``approved_by``)."""
        forecast: Forecast = self.get_object()  # type: ignore[assignment]
        approve_forecast(forecast, request.user)
        return Response(ForecastSerializer(forecast).data)

    @action(detail=True, methods=["post"], url_path="override")
    def override(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{amount, reason?}`` — apply a manual override + log audit row."""
        forecast: Forecast = self.get_object()  # type: ignore[assignment]
        amount = request.data.get("amount")
        if amount is None:
            return Response(
                {"detail": "amount is required."}, status=status.HTTP_400_BAD_REQUEST
            )
        apply_override(
            forecast,
            Decimal(str(amount)),
            adjusted_by=request.user,
            reason=request.data.get("reason", ""),
        )
        return Response(ForecastSerializer(forecast).data)

    @action(detail=False, methods=["get"], url_path="roll_up")
    def roll_up_action(self, request: Request) -> Response:
        """GET ``?period_type=monthly&period_start=YYYY-MM-DD`` — aggregate
        the caller's team's forecasts for the period.
        """
        period_type = request.query_params.get("period_type", PERIOD_MONTHLY)
        period_start = _parse_date(request.query_params.get("period_start"))
        if period_start is None:
            return Response(
                {"detail": "period_start (YYYY-MM-DD) is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            roll_up(request.user, period_type, period_start, tenant=request.tenant)
        )

    @action(detail=False, methods=["get"], url_path="accuracy")
    def accuracy_action(self, request: Request) -> Response:
        """GET ``?periods_back=3`` — predicted vs actual accuracy."""
        periods_back = int(request.query_params.get("periods_back", "3"))
        return Response(get_accuracy(request.user, periods_back=periods_back))

    @action(detail=False, methods=["get"], url_path="scenarios")
    def scenarios_action(self, request: Request) -> Response:
        """GET ``?period_type=monthly&period_start=YYYY-MM-DD`` — best /
        worst / most-likely scenarios for the caller.
        """
        period_type = request.query_params.get("period_type", PERIOD_MONTHLY)
        period_start = _parse_date(request.query_params.get("period_start"))
        if period_start is None:
            return Response(
                {"detail": "period_start (YYYY-MM-DD) is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user_id = request.query_params.get("user_id")
        from api.models import User  # noqa: PLC0415

        target_user = (
            User.objects.filter(pk=user_id).first() if user_id else request.user
        )
        if target_user is None:
            return Response(
                {"detail": "Unknown user_id."}, status=status.HTTP_400_BAD_REQUEST
            )
        return Response(
            get_scenarios(
                target_user, period_type, period_start, tenant=request.tenant
            )
        )


###############################################################################
# ForecastAdjustmentViewSet
###############################################################################


class ForecastAdjustmentViewSet(ModelViewSet):
    """List / retrieve / create adjustments (no PUT/PATCH/DELETE)."""

    pagination_class = CRMCursorPagination
    serializer_class = ForecastAdjustmentSerializer
    filterset_class = ForecastAdjustmentFilter
    queryset = ForecastAdjustment.objects.select_related("tenant", "forecast", "adjusted_by")
    http_method_names = ["get", "post", "head", "options"]

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: ForecastAdjustmentSerializer
    ) -> None:
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant, adjusted_by=self.request.user
        )


__all__ = ["ForecastAdjustmentViewSet", "ForecastViewSet"]
