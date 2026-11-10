"""DRF viewsets for the deals app.

Phase 8 extends this module with the pipeline engine:

* :class:`DealViewSet` gains four custom actions — ``transition``,
  ``available_transitions``, ``stage_history``, ``at_risk``.
* :class:`PipelineViewSet` (previously a thin CRUD shell) gains six
  analytics actions — ``stages`` (list + reorder), ``metrics``,
  ``velocity``, ``conversion_rates``, ``win_rate_by_stage``,
  ``monthly_trend``.
* :class:`StageViewSet` exposes a nested ``transitions`` action for
  inspecting / creating the outgoing edges of a stage.
* :class:`StageTransitionViewSet` provides standalone CRUD on the
  :class:`deals.models.StageTransition` model.
"""

from __future__ import annotations

from typing import Any, Iterable

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Model
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from api.crm_base import CRMModelViewSet, CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember
from deals.filters import DealFilter
from deals.models import Deal, DealContact, DealStageHistory, StageTransition
from deals.models_pipeline import Pipeline, Stage
from deals.serializers import (
    DealContactSerializer,
    DealSerializer,
    DealStageHistorySerializer,
    PipelineSerializer,
    StageSerializer,
    StageTransitionSerializer,
)
from deals.services import PipelineService


###############################################################################
# Pipeline + Stage + StageTransition
###############################################################################


class PipelineViewSet(ModelViewSet):
    """CRUD for pipelines + nested stages + analytics actions."""

    pagination_class = CRMCursorPagination
    serializer_class = PipelineSerializer
    permission_classes = [IsAuthenticated, IsTenantMember]

    def get_queryset(self) -> Any:
        return Pipeline.objects.all()

    def perform_create(self, serializer: PipelineSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    # ------------------------------------------------------------------ stages

    @action(detail=True, methods=["get"], url_path="stages")
    def list_stages(self, request: Request, pk: str | None = None) -> Response:
        """List the stages for this pipeline, ordered by ``order``."""
        pipeline = self.get_object()
        stages = Stage.objects.filter(pipeline=pipeline).order_by("order", "id")
        serializer = StageSerializer(stages, many=True, context={"request": request})
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="stages-reorder")
    def reorder_stages(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{"stage_ids": [<id>, <id>, ...]}`` to re-apply ``order``.

        The list is treated as the new ordering top-to-bottom. Stages not
        included in the list keep their existing ``order`` (the UI is
        expected to send the full list).
        """
        pipeline = self.get_object()
        stage_ids = request.data.get("stage_ids") or []
        if not isinstance(stage_ids, list) or not stage_ids:
            return Response(
                {"detail": "stage_ids must be a non-empty list."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        stages_by_id = {
            s.pk: s
            for s in Stage.objects.filter(pipeline=pipeline, pk__in=stage_ids)
        }
        if len(stages_by_id) != len(stage_ids):
            return Response(
                {"detail": "Some stage_ids don't belong to this pipeline."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        with transaction.atomic():
            for index, stage_id in enumerate(stage_ids):
                stage = stages_by_id[stage_id]
                if stage.order != index:
                    stage.order = index
                    stage.save(update_fields=["order", "updated_at"])
        return Response({"reordered": len(stage_ids)})

    # ------------------------------------------------------------------ analytics

    @action(detail=True, methods=["get"], url_path="metrics")
    def metrics(self, request: Request, pk: str | None = None) -> Response:
        """Per-stage + overall pipeline metrics (see ``PipelineService.get_pipeline_metrics``)."""
        pipeline = self.get_object()
        filters = self._extract_metric_filters(request)
        result = PipelineService().get_pipeline_metrics(pipeline, filters=filters)
        return Response(result)

    @action(detail=True, methods=["get"], url_path="velocity")
    def velocity(self, request: Request, pk: str | None = None) -> Response:
        """Avg time-in-stage bar-chart data."""
        pipeline = self.get_object()
        return Response(PipelineService().get_deal_velocity(pipeline))

    @action(detail=True, methods=["get"], url_path="conversion-rates")
    def conversion_rates(self, request: Request, pk: str | None = None) -> Response:
        """Per-stage forward-vs-lost conversion rates."""
        pipeline = self.get_object()
        return Response(PipelineService().get_stage_conversion_rates(pipeline))

    @action(detail=True, methods=["get"], url_path="win-rate-by-stage")
    def win_rate_by_stage(self, request: Request, pk: str | None = None) -> Response:
        """Where deals die — per-stage loss rates, sorted by ``lost_count`` desc."""
        pipeline = self.get_object()
        return Response(PipelineService().get_win_rate_by_stage(pipeline))

    @action(detail=True, methods=["get"], url_path="monthly-trend")
    def monthly_trend(self, request: Request, pk: str | None = None) -> Response:
        """Count + sum per month for the last N months (default 6)."""
        pipeline = self.get_object()
        try:
            months = int(request.query_params.get("months", 6))
        except (TypeError, ValueError):
            months = 6
        return Response(PipelineService().get_monthly_trend(pipeline, months=months))

    @staticmethod
    def _extract_metric_filters(request: Request) -> dict[str, Any]:
        """Translate ``?owner=``/``?stage_in=``/``?forecast_category=`` etc. into the
        filter dict consumed by :meth:`PipelineService.get_pipeline_metrics`.
        """
        params = request.query_params
        filters: dict[str, Any] = {}
        if "owner" in params:
            filters["owner_id"] = params["owner"]
        if "owner_in" in params:
            filters["owner_in"] = [
                int(x) for x in params["owner_in"].split(",") if x.strip().isdigit()
            ]
        if "stage_in" in params:
            filters["stage_in"] = [
                int(x) for x in params["stage_in"].split(",") if x.strip().isdigit()
            ]
        if "forecast_category" in params:
            filters["forecast_category"] = params["forecast_category"]
        if "close_date_gte" in params:
            filters["close_date_gte"] = params["close_date_gte"]
        if "close_date_lte" in params:
            filters["close_date_lte"] = params["close_date_lte"]
        if "amount_gte" in params:
            filters["amount_gte"] = params["amount_gte"]
        if "amount_lte" in params:
            filters["amount_lte"] = params["amount_lte"]
        return filters


class StageViewSet(ModelViewSet):
    """CRUD for stages.

    Phase 8 expands the writable fields to include ``probability``,
    ``color``, ``business_days_limit``, ``forecast_category``, ``icon``,
    and ``is_locked`` (see :class:`deals.serializers.StageSerializer`).
    """

    pagination_class = CRMCursorPagination
    serializer_class = StageSerializer
    permission_classes = [IsAuthenticated, IsTenantMember]

    def get_queryset(self) -> Any:
        return Stage.objects.all()

    def perform_create(self, serializer: StageSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    # ------------------------------------------------------------------ transitions

    @action(detail=True, methods=["get", "post"], url_path="transitions")
    def transitions(self, request: Request, pk: str | None = None) -> Response:
        """GET lists outgoing transitions; POST creates a new outgoing transition.

        POST body is the same shape as ``StageTransitionSerializer`` minus
        ``from_stage`` and ``pipeline`` (those are derived from this stage).
        """
        stage = self.get_object()
        if request.method == "GET":
            qs = StageTransition.objects.filter(from_stage=stage).select_related(
                "to_stage", "pipeline", "require_approval"
            )
            serializer = StageTransitionSerializer(qs, many=True, context={"request": request})
            return Response(serializer.data)

        # POST — create a new outgoing transition.
        data = dict(request.data)
        data["from_stage"] = stage.pk
        data["pipeline"] = stage.pipeline_id
        serializer = StageTransitionSerializer(data=data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save(
            tenant=self.request.tenant,  # type: ignore[attr-defined]
            from_stage=stage,
            pipeline=stage.pipeline,
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class StageTransitionViewSet(ModelViewSet):
    """CRUD for :class:`deals.models.StageTransition` (the directed edges)."""

    pagination_class = CRMCursorPagination
    serializer_class = StageTransitionSerializer
    permission_classes = [IsAuthenticated, IsTenantMember]

    def get_queryset(self) -> Any:
        qs = StageTransition.objects.select_related(
            "pipeline", "from_stage", "to_stage", "require_approval"
        )
        pipeline = self.request.query_params.get("pipeline")  # type: ignore[union-attr]
        if pipeline:
            qs = qs.filter(pipeline_id=pipeline)
        from_stage = self.request.query_params.get("from_stage")  # type: ignore[union-attr]
        if from_stage:
            qs = qs.filter(from_stage_id=from_stage)
        to_stage = self.request.query_params.get("to_stage")  # type: ignore[union-attr]
        if to_stage:
            qs = qs.filter(to_stage_id=to_stage)
        return qs

    def perform_create(self, serializer: StageTransitionSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


###############################################################################
# Deals
###############################################################################


class DealViewSet(CRMModelViewSet):
    """CRUD + bulk actions for :class:`deals.models.Deal`."""

    serializer_class = DealSerializer
    queryset = Deal.objects.all()
    filterset_class = DealFilter
    sort_fields: tuple[str, ...] = (
        "id",
        "name",
        "amount",
        "probability",
        "close_date",
        "created_at",
        "updated_at",
        "stage",
        "pipeline",
        "owner",
    )
    bulk_update_fields: tuple[str, ...] = (
        "owner",
        "stage",
        "pipeline",
        "close_date",
        "next_step",
        "type",
        "lead_source",
    )
    custom_field_module = "deal"
    required_permission: Iterable[str] | str = "crm.deals.read"

    # ------------------------------------------------------------------ per-action perms

    def get_required_permission(self, request: Request) -> str | None:
        method = request.method or ""
        if method in ("GET", "HEAD", "OPTIONS"):
            return "crm.deals.read"
        if method == "POST":
            return "crm.deals.create"
        if method in ("PUT", "PATCH"):
            return "crm.deals.update"
        if method == "DELETE":
            return "crm.deals.delete"
        return None

    def get_permissions(self) -> Any:
        perm = self.get_required_permission(self.request)
        if perm is not None:
            return [IsAuthenticated(), IsTenantMember(), HasPermission(perm)]
        return super().get_permissions()

    # ------------------------------------------------------------------ perform_create

    def perform_create(self, serializer: DealSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    # ------------------------------------------------------------------ merge override

    def _merge(self, source: Model, target: Model) -> None:  # type: ignore[override]
        """Copy non-empty fields from source → target, re-parent contacts."""
        if not isinstance(source, Deal) or not isinstance(target, Deal):
            return
        copyable = [
            "amount",
            "currency",
            "close_date",
            "next_step",
            "description",
            "lost_reason",
        ]
        for field in copyable:
            current = getattr(target, field)
            if not current:
                setattr(target, field, getattr(source, field))
        # Higher probability wins.
        if source.probability > target.probability:
            target.probability = source.probability
        # Merge competitors (union).
        source_comp = source.competitors or []
        target_comp = target.competitors or []
        target.competitors = list(dict.fromkeys([*target_comp, *source_comp]))

        # Re-parent DealContact rows.
        for dc in source.contact_links.all():
            DealContact.objects.get_or_create(
                deal=target, contact=dc.contact, defaults={"role": dc.role}
            )

        target.save()

    # ------------------------------------------------------------------ Phase 8 actions

    @action(detail=True, methods=["post"], url_path="transition")
    def transition(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{"to_stage": <id>, "reason": "..."}`` to move the deal.

        Routes through :meth:`PipelineService.transition_deal` so the
        transition is validated against the :class:`StageTransition` graph,
        the actor's role, and the ``conditions`` blob. On validation
        failure raises DRF ``ValidationError`` (HTTP 400/422) with a
        structured error payload.
        """
        deal = self.get_object()
        to_stage_id = request.data.get("to_stage")
        reason = request.data.get("reason") or ""
        if not to_stage_id:
            return Response(
                {"detail": "to_stage is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        to_stage = get_object_or_404(Stage, pk=to_stage_id, pipeline_id=deal.pipeline_id)
        service = PipelineService()
        try:
            result = service.transition_deal(deal, to_stage, request.user, reason=reason)
        except DjangoValidationError as exc:
            # Translate Django model validation into a DRF ValidationError
            # (HTTP 400 by default — caller can map to 422 if desired).
            raise DRFValidationError(_format_validation_error(exc)) from exc
        return Response(
            {
                "deal": DealSerializer(result.deal, context={"request": request}).data,
                "history": DealStageHistorySerializer(
                    result.history, context={"request": request}
                ).data,
                "approval_required": result.approval_required,
                "duration_in_previous_stage": result.duration_in_previous_stage,
            }
        )

    @action(detail=True, methods=["get"], url_path="available-transitions")
    def available_transitions(self, request: Request, pk: str | None = None) -> Response:
        """List the stages this deal can move to (per the transition graph)."""
        deal = self.get_object()
        stages = PipelineService().get_available_transitions(deal, request.user)
        return Response(StageSerializer(stages, many=True, context={"request": request}).data)

    @action(detail=True, methods=["get"], url_path="stage-history")
    def stage_history(self, request: Request, pk: str | None = None) -> Response:
        """Return the deal's full :class:`DealStageHistory` timeline."""
        deal = self.get_object()
        qs = DealStageHistory.objects.filter(deal=deal).select_related(
            "from_stage", "to_stage", "changed_by"
        )
        serializer = DealStageHistorySerializer(qs, many=True, context={"request": request})
        return Response(serializer.data)

    @action(detail=False, methods=["get"], url_path="at-risk")
    def at_risk(self, request: Request) -> Response:
        """List deals stuck in stage too long OR with a passed close_date.

        Optional query params:

        * ``pipeline`` — restrict to a single pipeline.
        """
        pipeline = None
        pipeline_id = request.query_params.get("pipeline")
        if pipeline_id:
            pipeline = get_object_or_404(Pipeline, pk=pipeline_id)
        deals = PipelineService().get_at_risk_deals(
            pipeline=pipeline,
            tenant=getattr(request, "tenant", None),
        )
        return Response({"count": len(deals), "results": deals})

    # ------------------------------------------------------------------ legacy actions

    @action(detail=True, methods=["post"], url_path="change-stage")
    def change_stage(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{"stage_id": <id>}`` to move a deal along the pipeline.

        .. deprecated:: Phase 8
            Prefer the ``transition`` action — it validates the move against
            the pipeline's transition graph. ``change_stage`` is kept for
            backward compatibility with existing integrations / tests.
        """
        deal = self.get_object()
        stage_id = request.data.get("stage_id")
        if not stage_id:
            return Response(
                {"detail": "stage_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        stage = get_object_or_404(Stage, pk=stage_id, pipeline_id=deal.pipeline_id)
        with transaction.atomic():
            deal.stage = stage
            deal.forecast_category = stage.forecast_category
            # Sync probability with terminal stages.
            if stage.is_won_stage:
                deal.probability = 100.0
            elif stage.is_lost_stage:
                deal.probability = 0.0
            deal.save(
                update_fields=["stage", "forecast_category", "probability", "updated_at"]
            )
        return Response(DealSerializer(deal, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="add-contact")
    def add_contact(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{"contact_id": <id>, "role": "decision_maker"}``."""
        deal = self.get_object()
        contact_id = request.data.get("contact_id")
        role = request.data.get("role", DealContact.ROLE_OTHER)
        if not contact_id:
            return Response(
                {"detail": "contact_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        from contacts.models import Contact

        contact = get_object_or_404(Contact, pk=contact_id)
        link, created = DealContact.objects.get_or_create(
            deal=deal, contact=contact, defaults={"role": role}
        )
        if not created and role != link.role:
            link.role = role
            link.save(update_fields=["role"])
        return Response(DealContactSerializer(link, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="remove-contact")
    def remove_contact(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{"contact_id": <id>}``."""
        deal = self.get_object()
        contact_id = request.data.get("contact_id")
        if not contact_id:
            return Response(
                {"detail": "contact_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        deleted, _ = DealContact.objects.filter(deal=deal, contact_id=contact_id).delete()
        return Response({"removed": deleted})


###############################################################################
# Helpers
###############################################################################


def _format_validation_error(exc: DjangoValidationError) -> dict[str, Any]:
    """Convert a :class:`django.core.exceptions.ValidationError` into a
    JSON-serializable dict suitable for a DRF error payload.
    """
    if hasattr(exc, "message_dict"):
        return exc.message_dict  # type: ignore[no-any-return]
    if isinstance(exc.messages, list):  # type: ignore[attr-defined]
        return {"detail": "; ".join(str(m) for m in exc.messages)}  # type: ignore[attr-defined]
    return {"detail": str(exc)}
