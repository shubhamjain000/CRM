"""DRF ViewSets for the territories app.

* :class:`TerritoryViewSet` — CRUD + ``members`` (add/remove) +
  ``realign``.
* :class:`TerritoryMemberViewSet` — CRUD.
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

from .filters import TerritoryFilter, TerritoryMemberFilter
from .models import Territory, TerritoryMember
from .serializers import TerritoryMemberSerializer, TerritorySerializer
from .services import realign_territory


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve", "members"):
        return [IsAuthenticated(), IsTenantMember()]
    return [IsAuthenticated(), IsTenantMember(), HasPermission("territories.manage")]


###############################################################################
# TerritoryViewSet
###############################################################################


class TerritoryViewSet(ModelViewSet):
    """CRUD + ``members`` + ``realign`` on :class:`Territory`."""

    pagination_class = CRMCursorPagination
    serializer_class = TerritorySerializer
    filterset_class = TerritoryFilter
    queryset = Territory.objects.select_related("tenant", "manager", "parent").prefetch_related(
        "members"
    )

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: TerritorySerializer
    ) -> None:
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant
        )

    @action(detail=True, methods=["get", "post", "delete"], url_path="members")
    def members(self, request: Request, pk: str | None = None) -> Response:
        """GET — list members. POST ``{user}`` — add. DELETE ``?user=`` — remove."""
        territory: Territory = self.get_object()  # type: ignore[assignment]
        if request.method == "GET":
            qs = territory.members.select_related("user").order_by("id")
            return Response(TerritoryMemberSerializer(qs, many=True).data)
        if request.method == "POST":
            user_id = request.data.get("user")
            if not user_id:
                return Response(
                    {"detail": "user is required."}, status=status.HTTP_400_BAD_REQUEST
                )
            member, created = TerritoryMember.objects.get_or_create(
                territory=territory, user_id=user_id,
                defaults={"tenant": territory.tenant},
            )
            return Response(
                TerritoryMemberSerializer(member).data,
                status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
            )
        # DELETE
        user_id = request.query_params.get("user")
        if not user_id:
            return Response(
                {"detail": "?user= is required."}, status=status.HTTP_400_BAD_REQUEST
            )
        TerritoryMember.objects.filter(
            territory=territory, user_id=user_id
        ).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="realign")
    def realign(self, request: Request, pk: str | None = None) -> Response:
        """POST — re-evaluate territory rules and re-assign matching records."""
        territory: Territory = self.get_object()  # type: ignore[assignment]
        result = realign_territory(territory)
        return Response(result)


###############################################################################
# TerritoryMemberViewSet
###############################################################################


class TerritoryMemberViewSet(ModelViewSet):
    """CRUD on :class:`TerritoryMember`."""

    pagination_class = CRMCursorPagination
    serializer_class = TerritoryMemberSerializer
    filterset_class = TerritoryMemberFilter
    queryset = TerritoryMember.objects.select_related("tenant", "territory", "user").all()

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: TerritoryMemberSerializer
    ) -> None:
        serializer.save(  # type: ignore[attr-defined]
            tenant=self.request.tenant
        )


__all__ = ["TerritoryMemberViewSet", "TerritoryViewSet"]
