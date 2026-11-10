"""DRF ViewSets for the marketing app.

* :class:`CampaignViewSet` — CRUD + ``send``.
* :class:`SubscriberListViewSet` — CRUD.
* :class:`MarketingEmailViewSet` — CRUD.
"""

from __future__ import annotations

from typing import Any

from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember

from .models import C_COMPLETED, C_RUNNING, Campaign, MarketingEmail, SubscriberList
from .serializers import (
    CampaignSerializer,
    MarketingEmailSerializer,
    SubscriberListSerializer,
)


def _perm_classes(action_name: str) -> list[Any]:
    if action_name in ("list", "retrieve"):
        return [IsAuthenticated(), IsTenantMember()]
    return [IsAuthenticated(), IsTenantMember(), HasPermission("marketing.manage")]


class CampaignViewSet(ModelViewSet):
    """CRUD on :class:`Campaign` + ``send``."""

    pagination_class = CRMCursorPagination
    serializer_class = CampaignSerializer
    queryset = Campaign.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(self, serializer: CampaignSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    @action(detail=True, methods=["post"], url_path="send")
    def send(self, request: Request, pk: str | None = None) -> Response:
        """POST — flip the campaign to ``running`` (and ``completed``
        immediately if ``end_date`` is in the past). In production this
        would enqueue the actual send job.
        """
        campaign: Campaign = self.get_object()  # type: ignore[assignment]
        campaign.status = C_RUNNING
        campaign.save(update_fields=["status", "updated_at"])
        return Response(CampaignSerializer(campaign).data)


class SubscriberListViewSet(ModelViewSet):
    """CRUD on :class:`SubscriberList`."""

    pagination_class = CRMCursorPagination
    serializer_class = SubscriberListSerializer
    queryset = SubscriberList.objects.select_related("tenant")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: SubscriberListSerializer
    ) -> None:
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


class MarketingEmailViewSet(ModelViewSet):
    """CRUD on :class:`MarketingEmail`."""

    pagination_class = CRMCursorPagination
    serializer_class = MarketingEmailSerializer
    queryset = MarketingEmail.objects.select_related("tenant", "campaign")

    def get_permissions(self) -> Any:
        return _perm_classes(self.action)

    def perform_create(  # type: ignore[override]
        self, serializer: MarketingEmailSerializer
    ) -> None:
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


__all__ = [
    "CampaignViewSet",
    "MarketingEmailViewSet",
    "SubscriberListViewSet",
]
