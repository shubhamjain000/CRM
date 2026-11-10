"""DRF ViewSets for the goals app.

* :class:`GoalViewSet` — CRUD + ``refresh`` / ``progress`` / ``leaderboard``.
* :class:`GoalAchievementViewSet` — list / retrieve + ``my_badges``.
"""

from __future__ import annotations

from typing import Any

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember

from .filters import GoalAchievementFilter, GoalFilter
from .models import Goal, GoalAchievement, METRIC_REVENUE, OWNER_USER, PERIOD_MONTHLY
from .serializers import GoalAchievementSerializer, GoalSerializer
from .services import (
    check_achievements,
    get_goal_progress,
    get_leaderboard,
    refresh_all_goals,
)


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve", "progress", "leaderboard", "my_badges"):
        return [IsAuthenticated(), IsTenantMember()]
    return [IsAuthenticated(), IsTenantMember(), HasPermission("goals.manage")]


###############################################################################
# GoalViewSet
###############################################################################


class GoalViewSet(ModelViewSet):
    """CRUD + lifecycle actions on :class:`Goal`."""

    pagination_class = CRMCursorPagination
    serializer_class = GoalSerializer
    filterset_class = GoalFilter
    queryset = Goal.objects.select_related("tenant", "parent_goal")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: GoalSerializer
    ) -> None:
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant
        )

    @action(detail=True, methods=["post"], url_path="refresh")
    def refresh(self, request: Request, pk: str | None = None) -> Response:
        """POST — recalculate this goal's ``actual_amount``."""
        goal: Goal = self.get_object()  # type: ignore[assignment]
        from .services import calculate_actual  # noqa: PLC0415

        new_actual = calculate_actual(goal)
        goal.actual_amount = new_actual
        goal.save(update_fields=["actual_amount", "updated_at"])
        # Run achievement checks for the goal's owner (if user-scoped).
        if goal.owner_type == OWNER_USER and goal.owner_id.isdigit():
            from api.models import User  # noqa: PLC0415

            target_user = User.objects.filter(pk=int(goal.owner_id)).first()
            if target_user is not None:
                check_achievements(target_user, tenant=goal.tenant)
        return Response(GoalSerializer(goal).data)

    @action(detail=False, methods=["post"], url_path="refresh_all")
    def refresh_all(self, request: Request) -> Response:
        """POST — recalculate every active goal in the tenant."""
        result = refresh_all_goals(tenant=request.tenant)
        return Response(result)

    @action(detail=False, methods=["get"], url_path="progress")
    def progress(self, request: Request) -> Response:
        """GET ``?metric=revenue&period_type=monthly&user_id?`` —
        return ``{target, actual, percentage, status}`` for the caller
        (or a specific user_id).
        """
        metric = request.query_params.get("metric", METRIC_REVENUE)
        period_type = request.query_params.get("period_type", PERIOD_MONTHLY)
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
            get_goal_progress(
                target_user, metric, period_type,
                tenant=request.tenant,
            )
        )

    @action(detail=False, methods=["get"], url_path="leaderboard")
    def leaderboard(self, request: Request) -> Response:
        """GET ``?metric=revenue&period_type=monthly&limit=10`` —
        rank users by ``actual_amount``.
        """
        metric = request.query_params.get("metric", METRIC_REVENUE)
        period_type = request.query_params.get("period_type", PERIOD_MONTHLY)
        limit = int(request.query_params.get("limit", "10"))
        return Response(
            {"leaderboard": get_leaderboard(metric, period_type, tenant=request.tenant, limit=limit)}
        )


###############################################################################
# GoalAchievementViewSet
###############################################################################


class GoalAchievementViewSet(ModelViewSet):
    """List / retrieve achievements + ``my_badges`` + ``check``.

    Achievements are normally auto-awarded by the daily refresh task;
    callers may also POST ``/check/`` to run the badge check on-demand
    for the caller.
    """

    pagination_class = CRMCursorPagination
    serializer_class = GoalAchievementSerializer
    filterset_class = GoalAchievementFilter
    queryset = GoalAchievement.objects.select_related("tenant", "user")
    http_method_names = ["get", "post", "head", "options"]

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: GoalAchievementSerializer
    ) -> None:
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant, user=self.request.user
        )

    @action(detail=False, methods=["get"], url_path="my_badges")
    def my_badges(self, request: Request) -> Response:
        """GET — list the caller's badges."""
        qs = GoalAchievement.objects.filter(user=request.user).order_by("-awarded_at")
        return Response(GoalAchievementSerializer(qs, many=True).data)

    @action(detail=False, methods=["post"], url_path="check")
    def check(self, request: Request) -> Response:
        """POST — run the badge check for the caller; returns newly-awarded badges."""
        awarded = check_achievements(request.user, tenant=request.tenant)
        return Response({"awarded": awarded})


__all__ = ["GoalAchievementViewSet", "GoalViewSet"]
