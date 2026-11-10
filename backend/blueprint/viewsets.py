"""DRF ViewSets for the blueprint app.

Four ViewSets expose the blueprint engine:

* :class:`BlueprintViewSet` — CRUD + ``publish`` / ``archive`` / ``versions``
  / ``preview`` actions. Permission: ``IsTenantMember`` +
  ``HasPermission('blueprints.manage')`` for writes; reads are open to
  any tenant member.
* :class:`BlueprintStateViewSet` — CRUD on the per-blueprint states.
* :class:`BlueprintTransitionViewSet` — CRUD on transitions + nested
  ``field_requirements`` / ``assignments`` actions.
* :class:`BlueprintExecutionViewSet` — read-only list / retrieve +
  ``available_transitions`` / ``execute_transition`` /
  ``compliance_report`` / ``stuck_deals`` actions.

All viewsets inherit :class:`api.crm_base.CRMCursorPagination` (page_size
50, max 200) and are scoped by :class:`api.managers.TenantManager`.
"""

from __future__ import annotations

from typing import Any

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from api.crm_base import CRMCursorPagination
from api.permissions import HasPermission, IsTenantMember
from blueprint.filters import BlueprintExecutionFilter, BlueprintFilter
from blueprint.models import (
    Blueprint,
    BlueprintExecution,
    BlueprintState,
    BlueprintTransition,
)
from blueprint.serializers import (
    BlueprintAssignmentSerializer,
    BlueprintExecutionSerializer,
    BlueprintFieldRequirementSerializer,
    BlueprintSerializer,
    BlueprintStateSerializer,
    BlueprintTransitionSerializer,
)
from blueprint.services import BlueprintService
from deals.models import Deal
from deals.models_pipeline import Pipeline


###############################################################################
# Blueprint
###############################################################################


class BlueprintViewSet(ModelViewSet):
    """CRUD + lifecycle actions for :class:`blueprint.models.Blueprint`.

    Writes (create / update / destroy / publish / archive) require the
    ``blueprints.manage`` permission. Reads (list / retrieve / versions /
    preview) require only tenant membership.
    """

    pagination_class = CRMCursorPagination
    serializer_class = BlueprintSerializer
    filterset_class = BlueprintFilter
    queryset = Blueprint.objects.select_related("pipeline").prefetch_related(
        "states__stage", "states__timers", "transitions__from_state", "transitions__to_state"
    )

    def get_permissions(self) -> Any:
        if self.action in ("list", "retrieve", "versions", "preview"):
            return [IsAuthenticated(), IsTenantMember()]
        return [IsAuthenticated(), IsTenantMember(), HasPermission("blueprints.manage")]

    def get_queryset(self) -> Any:
        qs = super().get_queryset()
        pipeline = self.request.query_params.get("pipeline")  # type: ignore[union-attr]
        if pipeline:
            qs = qs.filter(pipeline_id=pipeline)
        is_active = self.request.query_params.get("is_active")  # type: ignore[union-attr]
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() in ("true", "1"))
        return qs

    def perform_create(self, serializer: BlueprintSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    def perform_update(self, serializer: BlueprintSerializer) -> None:  # type: ignore[override]
        # Published blueprints are immutable — reject writes.
        instance: Blueprint = serializer.instance  # type: ignore[assignment]
        if instance.is_published and "is_published" not in serializer.validated_data:
            # Allow toggling ``is_active`` but reject structural edits.
            allowed_keys = set(serializer.validated_data.keys())
            if allowed_keys - {"is_active"}:
                raise DRFValidationError(
                    {"detail": "Published blueprints are immutable. Archive first to edit."}
                )
        serializer.save()

    # ------------------------------------------------------------------ actions

    @action(detail=True, methods=["post"], url_path="publish")
    def publish(self, request: Request, pk: str | None = None) -> Response:
        """Mark the blueprint as published + active (bumps ``version``).

        Publishing also deactivates any other active blueprint on the same
        pipeline (enforced by the ``blueprint_one_active_per_pipeline``
        partial unique constraint).
        """
        blueprint = self.get_object()
        with transaction.atomic():
            # Deactivate other active blueprints on the same pipeline.
            Blueprint.objects.filter(
                tenant=blueprint.tenant,
                pipeline=blueprint.pipeline,
                is_active=True,
            ).exclude(pk=blueprint.pk).update(is_active=False)
            blueprint.is_active = True
            blueprint.is_published = True
            blueprint.version = (blueprint.version or 0) + 1
            blueprint.save(update_fields=["is_active", "is_published", "version", "updated_at"])
        return Response(
            BlueprintSerializer(blueprint, context={"request": request}).data
        )

    @action(detail=True, methods=["post"], url_path="archive")
    def archive(self, request: Request, pk: str | None = None) -> Response:
        """Deactivate the blueprint (``is_active=False``). Keeps ``is_published`` for history."""
        blueprint = self.get_object()
        blueprint.is_active = False
        blueprint.save(update_fields=["is_active", "updated_at"])
        return Response(
            BlueprintSerializer(blueprint, context={"request": request}).data
        )

    @action(detail=True, methods=["get"], url_path="versions")
    def versions(self, request: Request, pk: str | None = None) -> Response:
        """List every version of the blueprint (by ``pipeline``, ordered by ``-version``)."""
        blueprint = self.get_object()
        versions = (
            Blueprint.objects.filter(tenant=blueprint.tenant, pipeline=blueprint.pipeline)
            .order_by("-version", "-created_at")
        )
        return Response(
            BlueprintSerializer(versions, many=True, context={"request": request}).data
        )

    @action(detail=True, methods=["post"], url_path="preview")
    def preview(self, request: Request, pk: str | None = None) -> Response:
        """Dry-run the blueprint against a sample deal.

        POST body: ``{"deal_id": <id>}``. Returns the
        :meth:`BlueprintService.get_available_transitions` result so the
        caller can preview the moves the blueprint would permit. The
        blueprint must be active and the deal must already have a
        :class:`BlueprintExecution` (created automatically by the
        ``Deal.post_save`` signal when an active blueprint is present).
        """
        blueprint = self.get_object()
        deal_id = request.data.get("deal_id")
        if not deal_id:
            return Response(
                {"detail": "deal_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        deal = get_object_or_404(Deal, pk=deal_id, pipeline_id=blueprint.pipeline_id)
        service = BlueprintService()
        execution = service._get_execution(deal)  # noqa: SLF001 — preview is admin-only
        if execution is None:
            return Response(
                {
                    "deal_id": deal.pk,
                    "blueprint_id": blueprint.pk,
                    "current_state_id": None,
                    "transitions": [],
                    "valid": False,
                    "errors": [
                        "Deal has no blueprint execution. Create the deal in a "
                        "pipeline with an active blueprint first."
                    ],
                }
            )
        transitions = service.get_available_transitions(deal, request.user)
        return Response(
            {
                "deal_id": deal.pk,
                "blueprint_id": blueprint.pk,
                "current_state_id": execution.current_state_id,
                "transitions": transitions,
            }
        )


###############################################################################
# BlueprintState
###############################################################################


class BlueprintStateViewSet(ModelViewSet):
    """CRUD for :class:`blueprint.models.BlueprintState`."""

    pagination_class = CRMCursorPagination
    serializer_class = BlueprintStateSerializer
    permission_classes = [IsAuthenticated, IsTenantMember, HasPermission("blueprints.manage")]

    def get_queryset(self) -> Any:
        qs = BlueprintState.objects.select_related("blueprint", "stage", "escalation_blueprint")
        blueprint = self.request.query_params.get("blueprint")  # type: ignore[union-attr]
        if blueprint:
            qs = qs.filter(blueprint_id=blueprint)
        state_type = self.request.query_params.get("state_type")  # type: ignore[union-attr]
        if state_type:
            qs = qs.filter(state_type=state_type)
        return qs

    def perform_create(self, serializer: BlueprintStateSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]


###############################################################################
# BlueprintTransition
###############################################################################


class BlueprintTransitionViewSet(ModelViewSet):
    """CRUD for :class:`blueprint.models.BlueprintTransition` + nested field-requirements + assignments."""

    pagination_class = CRMCursorPagination
    serializer_class = BlueprintTransitionSerializer
    permission_classes = [IsAuthenticated, IsTenantMember, HasPermission("blueprints.manage")]

    def get_queryset(self) -> Any:
        qs = BlueprintTransition.objects.select_related(
            "blueprint",
            "from_state__stage",
            "to_state__stage",
            "require_approval",
        ).prefetch_related("field_requirements", "assignments")
        blueprint = self.request.query_params.get("blueprint")  # type: ignore[union-attr]
        if blueprint:
            qs = qs.filter(blueprint_id=blueprint)
        from_state = self.request.query_params.get("from_state")  # type: ignore[union-attr]
        if from_state:
            qs = qs.filter(from_state_id=from_state)
        to_state = self.request.query_params.get("to_state")  # type: ignore[union-attr]
        if to_state:
            qs = qs.filter(to_state_id=to_state)
        return qs

    def perform_create(self, serializer: BlueprintTransitionSerializer) -> None:  # type: ignore[override]
        serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]

    # ------------------------------------------------------------------ nested collections

    @action(detail=True, methods=["get", "post"], url_path="field-requirements")
    def field_requirements(self, request: Request, pk: str | None = None) -> Response:
        """GET lists the transition's field requirements; POST creates one."""
        transition: BlueprintTransition = self.get_object()  # type: ignore[assignment]
        if request.method == "GET":
            qs = transition.field_requirements.all()
            return Response(
                BlueprintFieldRequirementSerializer(
                    qs, many=True, context={"request": request}
                ).data
            )
        data = dict(request.data)
        data["transition"] = transition.pk
        serializer = BlueprintFieldRequirementSerializer(data=data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save(tenant=self.request.tenant, transition=transition)  # type: ignore[attr-defined]
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get", "post"], url_path="assignments")
    def assignments(self, request: Request, pk: str | None = None) -> Response:
        """GET lists the transition's assignments; POST creates one."""
        transition: BlueprintTransition = self.get_object()  # type: ignore[assignment]
        if request.method == "GET":
            qs = transition.assignments.all()
            return Response(
                BlueprintAssignmentSerializer(
                    qs, many=True, context={"request": request}
                ).data
            )
        data = dict(request.data)
        data["transition"] = transition.pk
        serializer = BlueprintAssignmentSerializer(data=data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save(tenant=self.request.tenant, transition=transition)  # type: ignore[attr-defined]
        return Response(serializer.data, status=status.HTTP_201_CREATED)


###############################################################################
# BlueprintExecution
###############################################################################


class BlueprintExecutionViewSet(ModelViewSet):
    """Read-only list / retrieve for :class:`blueprint.models.BlueprintExecution` + runtime actions.

    Actions:

    * ``available_transitions`` (GET) — list the transitions the deal can
      take from its current state (per
      :meth:`BlueprintService.get_available_transitions`).
    * ``execute_transition`` (POST ``{"to_state": <id>, "reason": "..."}``)
      — execute a transition via
      :meth:`BlueprintService.execute_transition`.
    * ``compliance_report`` (GET ``?pipeline=<id>``) — pipeline-wide
      blueprint-adoption metrics.
    * ``stuck_deals`` (GET ``?pipeline=<id>``) — deals whose current
      state has exceeded its ``time_limit_hours``.
    """

    pagination_class = CRMCursorPagination
    serializer_class = BlueprintExecutionSerializer
    permission_classes = [IsAuthenticated, IsTenantMember]
    filterset_class = BlueprintExecutionFilter
    queryset = BlueprintExecution.objects.select_related(
        "deal", "blueprint", "current_state__stage"
    )

    def get_permissions(self) -> Any:
        # Writes (execute_transition) require manage permission; reads +
        # analytics are open to any tenant member.
        if self.action == "execute_transition":
            return [IsAuthenticated(), IsTenantMember(), HasPermission("blueprints.manage")]
        return [IsAuthenticated(), IsTenantMember()]

    def get_queryset(self) -> Any:
        qs = super().get_queryset()
        pipeline = self.request.query_params.get("pipeline")  # type: ignore[union-attr]
        if pipeline:
            qs = qs.filter(blueprint__pipeline_id=pipeline)
        deal = self.request.query_params.get("deal")  # type: ignore[union-attr]
        if deal:
            qs = qs.filter(deal_id=deal)
        owner = self.request.query_params.get("owner")  # type: ignore[union-attr]
        if owner:
            qs = qs.filter(deal__owner_id=owner)
        is_complete = self.request.query_params.get("is_complete")  # type: ignore[union-attr]
        if is_complete is not None:
            qs = qs.filter(is_complete=is_complete.lower() in ("true", "1"))
        is_stuck = self.request.query_params.get("is_stuck")  # type: ignore[union-attr]
        if is_stuck is not None and is_stuck.lower() in ("true", "1"):
            from django.utils import timezone

            threshold = timezone.now()
            qs = qs.exclude(current_state__time_limit_hours__isnull=True).filter(
                entered_state_at__lt=threshold,
                is_complete=False,
            )
        return qs

    # ------------------------------------------------------------------ actions

    @action(detail=True, methods=["get"], url_path="available-transitions")
    def available_transitions(self, request: Request, pk: str | None = None) -> Response:
        """List the transitions the deal can take from its current state."""
        execution: BlueprintExecution = self.get_object()  # type: ignore[assignment]
        deal = execution.deal
        transitions = BlueprintService().get_available_transitions(deal, request.user)
        return Response(
            {
                "execution_id": execution.pk,
                "deal_id": deal.pk,
                "current_state_id": execution.current_state_id,
                "transitions": transitions,
            }
        )

    @action(detail=True, methods=["post"], url_path="execute-transition")
    def execute_transition(self, request: Request, pk: str | None = None) -> Response:
        """POST ``{"to_state": <id>, "reason": "..."}`` to move the deal."""
        execution: BlueprintExecution = self.get_object()  # type: ignore[assignment]
        to_state_id = request.data.get("to_state")
        reason = request.data.get("reason") or ""
        if not to_state_id:
            return Response(
                {"detail": "to_state is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        to_state = get_object_or_404(BlueprintState, pk=to_state_id, blueprint_id=execution.blueprint_id)
        service = BlueprintService()
        try:
            updated = service.execute_transition(execution.deal, to_state, request.user, reason=reason)
        except DjangoValidationError as exc:
            raise DRFValidationError(_format_validation_error(exc)) from exc
        return Response(
            BlueprintExecutionSerializer(updated, context={"request": request}).data
        )

    @action(detail=False, methods=["get"], url_path="compliance-report")
    def compliance_report(self, request: Request) -> Response:
        """Pipeline-wide blueprint-adoption metrics.

        Query param: ``pipeline=<id>`` (required).
        """
        pipeline_id = request.query_params.get("pipeline")
        if not pipeline_id:
            return Response(
                {"detail": "pipeline query param is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        pipeline = get_object_or_404(Pipeline, pk=pipeline_id)
        report = BlueprintService().get_compliance_report(pipeline)
        return Response(report)

    @action(detail=False, methods=["get"], url_path="stuck-deals")
    def stuck_deals(self, request: Request) -> Response:
        """Deals whose current blueprint state has exceeded ``time_limit_hours``.

        Query param: ``pipeline=<id>`` (required).
        """
        pipeline_id = request.query_params.get("pipeline")
        if not pipeline_id:
            return Response(
                {"detail": "pipeline query param is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        pipeline = get_object_or_404(Pipeline, pk=pipeline_id)
        deals = BlueprintService().get_stuck_deals(pipeline)
        return Response({"count": len(deals), "results": deals})


###############################################################################
# Helpers
###############################################################################


def _format_validation_error(exc: DjangoValidationError) -> dict[str, Any]:
    """Translate a Django ``ValidationError`` into a JSON-safe dict for DRF."""
    if hasattr(exc, "message_dict"):
        return exc.message_dict  # type: ignore[no-any-return]
    if isinstance(exc.messages, list):  # type: ignore[attr-defined]
        return {"detail": "; ".join(str(m) for m in exc.messages)}  # type: ignore[attr-defined]
    return {"detail": str(exc)}


__all__ = [
    "BlueprintExecutionViewSet",
    "BlueprintStateViewSet",
    "BlueprintTransitionViewSet",
    "BlueprintViewSet",
]
