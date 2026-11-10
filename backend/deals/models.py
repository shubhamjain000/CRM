"""Deal model — a sales opportunity.

Phase 8 extends this module with three pipeline-engine models:

* :class:`deals.models.StageTransition` — the directed edge in a
  pipeline's stage graph. Carries an ``allowed_roles`` allow-list and a
  ``conditions`` JSON blob that :class:`deals.services.PipelineService`
  evaluates before moving a deal. ``require_approval`` FK now points to
  the canonical :class:`approvals.models.ApprovalProcess` (Phase 10
  promoted the Phase-8 stub to the ``approvals`` app and extended the
  schema with target_model / trigger_criteria / version + the runtime
  ApprovalStep / ApprovalRequest / ApprovalAction / ApprovalDelegation
  models).
* :class:`DealStageHistory` — append-only audit of every stage
  transition. Records the prior stage, the new stage, the actor, the
  reason, and the number of seconds the deal spent in the prior stage.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from accounts.models import Account
from api.models import TenantModel, User
from api.soft_delete import SoftDeleteTenantModel
from contacts.models import Contact
from deals.models_pipeline import (
    FORECAST_CATEGORY_CHOICES,
    FORECAST_CATEGORY_PIPELINE,
    Pipeline,
    Stage,
)


class Deal(SoftDeleteTenantModel):
    """A sales opportunity in a pipeline."""

    TYPE_NEW_BUSINESS = "new_business"
    TYPE_EXISTING_BUSINESS = "existing_business"
    TYPE_RENEWAL = "renewal"
    TYPE_CHOICES = [
        (TYPE_NEW_BUSINESS, "New Business"),
        (TYPE_EXISTING_BUSINESS, "Existing Business"),
        (TYPE_RENEWAL, "Renewal"),
    ]

    LEAD_SOURCE_WEB = "web"
    LEAD_SOURCE_REFERRAL = "referral"
    LEAD_SOURCE_EVENT = "event"
    LEAD_SOURCE_OTHER = "other"
    LEAD_SOURCE_CHOICES = [
        (LEAD_SOURCE_WEB, "Web"),
        (LEAD_SOURCE_REFERRAL, "Referral"),
        (LEAD_SOURCE_EVENT, "Event"),
        (LEAD_SOURCE_OTHER, "Other"),
    ]

    name = models.CharField(max_length=255, db_index=True)
    amount = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    currency = models.CharField(max_length=8, default="USD")
    stage = models.ForeignKey(
        Stage,
        on_delete=models.RESTRICT,
        related_name="deals",
        db_index=True,
    )
    pipeline = models.ForeignKey(
        Pipeline,
        on_delete=models.RESTRICT,
        related_name="deals",
        db_index=True,
    )
    close_date = models.DateField(null=True, blank=True)
    probability = models.FloatField(
        default=0.0,
        help_text="Win-probability 0-100. Overrides the stage default when set explicitly.",
    )
    # ----- Phase 8: forecast category (derived from stage, refreshed on transition) -
    forecast_category = models.CharField(
        max_length=16,
        choices=FORECAST_CATEGORY_CHOICES,
        default=FORECAST_CATEGORY_PIPELINE,
        db_index=True,
        help_text=(
            "Forecast bucket for this deal. Derived from the current stage and "
            "refreshed by PipelineService.transition_deal on every move."
        ),
    )
    account = models.ForeignKey(
        Account,
        on_delete=models.RESTRICT,
        null=True,
        blank=True,
        related_name="deals",
        db_index=True,
    )
    primary_contact = models.ForeignKey(
        Contact,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="deal_primary",
    )
    contacts = models.ManyToManyField(
        Contact,
        through="DealContact",
        related_name="deal_contacts",
        blank=True,
    )
    owner = models.ForeignKey(
        User,
        on_delete=models.RESTRICT,
        related_name="owned_deals",
    )
    lead_source = models.CharField(max_length=32, choices=LEAD_SOURCE_CHOICES, blank=True, default="")
    type = models.CharField(max_length=32, choices=TYPE_CHOICES, default=TYPE_NEW_BUSINESS)
    next_step = models.CharField(max_length=255, blank=True, default="")
    description = models.TextField(blank=True, default="")
    lost_reason = models.TextField(blank=True, default="")
    competitors = models.JSONField(default=list, blank=True)

    class Meta:
        db_table = "deals_deal"
        verbose_name = "deal"
        verbose_name_plural = "deals"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(probability__gte=0.0) & models.Q(probability__lte=100.0),
                name="deal_probability_range",
            ),
            models.CheckConstraint(
                condition=models.Q(type__in=("new_business", "existing_business", "renewal")),
                name="deal_type_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    forecast_category__in=(
                        "pipeline",
                        "best_case",
                        "commit",
                        "closed",
                        "omitted",
                    )
                ),
                name="deal_forecast_category_valid",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "deleted_at"], name="deal_tenant_deleted_idx"),
            models.Index(fields=["tenant", "stage"], name="deal_tenant_stage_idx"),
            models.Index(fields=["tenant", "owner"], name="deal_tenant_owner_idx"),
            models.Index(fields=["tenant", "pipeline"], name="deal_tenant_pipeline_idx"),
            models.Index(fields=["tenant", "close_date"], name="deal_tenant_close_idx"),
            models.Index(
                fields=["tenant", "forecast_category"],
                name="deal_tenant_fc_idx",
            ),
        ]

    def __str__(self) -> str:
        return self.name

    # ------------------------------------------------------------------ computed

    @property
    def expected_revenue(self) -> Decimal:
        """``amount * probability / 100``."""
        prob = Decimal(str(self.probability or 0))
        return (self.amount or Decimal(0)) * prob / Decimal(100)

    @property
    def age(self) -> int:
        """Days since ``created_at``."""
        delta = date.today() - self.created_at.date()
        return max(delta.days, 0)

    @property
    def is_won(self) -> bool:
        return bool(self.stage_id and self.stage.is_won_stage)

    @property
    def is_lost(self) -> bool:
        return bool(self.stage_id and self.stage.is_lost_stage)

    @property
    def is_open(self) -> bool:
        return not self.is_won and not self.is_lost


class DealContact(models.Model):
    """Through table for ``Deal.contacts`` M2M.

    Captures the role a contact plays on a deal (e.g. ``decision_maker``,
    ``influencer``).
    """

    ROLE_DECISION_MAKER = "decision_maker"
    ROLE_INFLUENCER = "influencer"
    ROLE_EVALUATOR = "evaluator"
    ROLE_OTHER = "other"
    ROLE_CHOICES = [
        (ROLE_DECISION_MAKER, "Decision Maker"),
        (ROLE_INFLUENCER, "Influencer"),
        (ROLE_EVALUATOR, "Evaluator"),
        (ROLE_OTHER, "Other"),
    ]

    deal = models.ForeignKey(Deal, on_delete=models.CASCADE, related_name="contact_links")
    contact = models.ForeignKey(Contact, on_delete=models.CASCADE, related_name="deal_links")
    role = models.CharField(max_length=32, choices=ROLE_CHOICES, default=ROLE_OTHER)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "deals_dealcontact"
        unique_together = (("deal", "contact"),)
        indexes = [
            models.Index(fields=["deal", "role"], name="dealcontact_deal_role_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.deal.name} ↔ {self.contact.full_name} ({self.role})"


###############################################################################
# Phase 8 — pipeline engine
###############################################################################


class StageTransition(TenantModel):
    """A directed edge ``from_stage → to_stage`` inside a :class:`Pipeline`.

    Rules enforced by :class:`deals.services.PipelineService.transition_deal`:

    * A transition must exist for ``(pipeline, from_stage, to_stage)`` —
      arbitrary stage moves are rejected.
    * ``allowed_roles`` (list of role names) gates the transition by the
      actor's role. An empty list means **all roles** may transition.
    * ``conditions`` is a small JSON rule set evaluated against the deal.
      Supported keys:

      ``min_amount`` / ``max_amount``
          Deal ``amount`` must be within the inclusive range.
      ``min_probability`` / ``max_probability``
          Deal ``probability`` must be within the inclusive range.
      ``require_account``
          Boolean — deal must have an ``account`` set.
      ``require_close_date``
          Boolean — deal must have a ``close_date`` set.

    * ``require_approval`` (nullable FK) — when set, the transition is
      *gated* by an approval process. The actual approval workflow is
      delivered in Phase 9; today the field is informational and the
      service treats ``require_approval_id is not None`` as a soft warning
      in the response payload.
    """

    tenant = models.ForeignKey(
        "api.Organization",
        on_delete=models.CASCADE,
        related_name="stage_transitions",
        db_index=True,
    )
    pipeline = models.ForeignKey(
        Pipeline,
        on_delete=models.CASCADE,
        related_name="transitions",
        db_index=True,
    )
    from_stage = models.ForeignKey(
        Stage,
        on_delete=models.CASCADE,
        related_name="outgoing_transitions",
        db_index=True,
    )
    to_stage = models.ForeignKey(
        Stage,
        on_delete=models.CASCADE,
        related_name="incoming_transitions",
        db_index=True,
    )
    allowed_roles = models.JSONField(
        default=list,
        blank=True,
        help_text="List of role names permitted to take this transition. Empty = all roles.",
    )
    conditions = models.JSONField(
        default=dict,
        blank=True,
        help_text=(
            'Rule set, e.g. {"min_amount": 10000, "require_account": true}. '
            "See StageTransition docstring for supported keys."
        ),
    )
    require_approval = models.ForeignKey(
        "approvals.ApprovalProcess",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stage_transitions",
        help_text="Optional approval gate (Phase 10 enforces the workflow via the approvals app).",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "deals_stagetransition"
        verbose_name = "stage transition"
        verbose_name_plural = "stage transitions"
        unique_together = (("pipeline", "from_stage", "to_stage"),)
        indexes = [
            models.Index(fields=["pipeline", "from_stage"], name="stage_trans_from_idx"),
            models.Index(fields=["pipeline", "to_stage"], name="stage_trans_to_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.from_stage.name} → {self.to_stage.name}"

    def clean(self) -> None:  # type: ignore[override]
        super().clean()
        if self.from_stage_id and self.to_stage_id and self.from_stage_id == self.to_stage_id:
            raise ValidationError({"to_stage": "from_stage and to_stage must differ."})
        if (
            self.pipeline_id
            and self.from_stage_id
            and self.from_stage.pipeline_id != self.pipeline_id
        ):
            raise ValidationError({"from_stage": "from_stage must belong to the pipeline."})
        if (
            self.pipeline_id
            and self.to_stage_id
            and self.to_stage.pipeline_id != self.pipeline_id
        ):
            raise ValidationError({"to_stage": "to_stage must belong to the pipeline."})


class DealStageHistory(TenantModel):
    """Append-only audit trail of every stage transition for a :class:`Deal`.

    A row is created by :class:`deals.services.PipelineService.transition_deal`
    on every successful move. ``duration_in_previous_stage`` is the wall-clock
    seconds the deal spent in ``from_stage`` (computed from the prior history
    entry's ``changed_at`` or the deal's ``created_at`` if this is the first
    transition).
    """

    tenant = models.ForeignKey(
        "api.Organization",
        on_delete=models.CASCADE,
        related_name="deal_stage_histories",
        db_index=True,
    )
    deal = models.ForeignKey(
        Deal,
        on_delete=models.CASCADE,
        related_name="stage_history",
        db_index=True,
    )
    from_stage = models.ForeignKey(
        Stage,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="deal_exits",
    )
    to_stage = models.ForeignKey(
        Stage,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="deal_entries",
    )
    changed_by = models.ForeignKey(
        User,
        on_delete=models.RESTRICT,
        related_name="deal_stage_changes",
    )
    changed_at = models.DateTimeField(default=timezone.now)
    reason = models.TextField(blank=True, default="")
    duration_in_previous_stage = models.BigIntegerField(
        default=0,
        help_text="Seconds the deal spent in from_stage before this transition.",
    )

    class Meta:
        db_table = "deals_dealstagehistory"
        verbose_name = "deal stage history"
        verbose_name_plural = "deal stage histories"
        ordering = ["-changed_at"]
        indexes = [
            models.Index(fields=["deal", "changed_at"], name="deal_hist_deal_changed_idx"),
            models.Index(
                fields=["tenant", "to_stage", "changed_at"],
                name="deal_hist_tenant_to_stage_idx",
            ),
            models.Index(fields=["tenant", "deal"], name="deal_hist_tenant_deal_idx"),
        ]

    def __str__(self) -> str:
        return f"Deal {self.deal_id} {self.from_stage_id} → {self.to_stage_id} @ {self.changed_at}"
