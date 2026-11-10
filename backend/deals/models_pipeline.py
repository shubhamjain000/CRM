"""Pipeline + Stage models.

A :class:`Pipeline` is a sequence of :class:`Stage`s. Each tenant gets a
default ``Sales Pipeline`` seeded by ``seed_crm``. Stages carry a default
``probability`` and flags ``is_won_stage`` / ``is_lost_stage`` which drive the
``Deal.is_won`` / ``Deal.is_lost`` computed properties.

Phase 8 extends the stage model with **forecast category** (pipeline /
best_case / commit / closed / omitted), a **business-days limit** (alerts when
a deal is stuck), a lock flag, and presentation fields (``color`` + ``icon``).
"""

from __future__ import annotations

from typing import Any

from django.core.exceptions import ValidationError
from django.db import models

from api.soft_delete import SoftDeleteTenantModel


# --------------------------------------------------------------------------- forecast
#: Forecast category choices — used on both :class:`Stage` and
#: :class:`deals.models.Deal` (the deal's category is derived from its stage
#: and refreshed on every transition by :class:`deals.services.PipelineService`).
FORECAST_CATEGORY_PIPELINE = "pipeline"
FORECAST_CATEGORY_BEST_CASE = "best_case"
FORECAST_CATEGORY_COMMIT = "commit"
FORECAST_CATEGORY_CLOSED = "closed"
FORECAST_CATEGORY_OMITTED = "omitted"
FORECAST_CATEGORY_CHOICES = [
    (FORECAST_CATEGORY_PIPELINE, "Pipeline"),
    (FORECAST_CATEGORY_BEST_CASE, "Best Case"),
    (FORECAST_CATEGORY_COMMIT, "Commit"),
    (FORECAST_CATEGORY_CLOSED, "Closed"),
    (FORECAST_CATEGORY_OMITTED, "Omitted"),
]


class Pipeline(SoftDeleteTenantModel):
    """A named pipeline (e.g. ``Sales Pipeline``, ``Renewal Pipeline``)."""

    name = models.CharField(max_length=128)
    is_default = models.BooleanField(default=False)
    description = models.TextField(blank=True, default="")

    class Meta:
        db_table = "deals_pipeline"
        verbose_name = "pipeline"
        verbose_name_plural = "pipelines"
        unique_together = (("tenant", "name"),)
        indexes = [
            models.Index(fields=["tenant", "deleted_at"], name="pipeline_tenant_deleted_idx"),
        ]

    def __str__(self) -> str:
        return self.name


class Stage(SoftDeleteTenantModel):
    """A stage inside a :class:`Pipeline`."""

    pipeline = models.ForeignKey(
        Pipeline,
        on_delete=models.CASCADE,
        related_name="stages",
        db_index=True,
    )
    name = models.CharField(max_length=128)
    probability = models.FloatField(default=0.0, help_text="Win-probability default 0-100.")
    order = models.PositiveIntegerField(default=0)
    is_won_stage = models.BooleanField(default=False)
    is_lost_stage = models.BooleanField(default=False)
    is_closed = models.BooleanField(default=False, help_text="True for won/lost terminal stages.")
    # ----- Phase 8 additions -------------------------------------------------------
    forecast_category = models.CharField(
        max_length=16,
        choices=FORECAST_CATEGORY_CHOICES,
        default=FORECAST_CATEGORY_PIPELINE,
        db_index=True,
        help_text=(
            "Forecast bucket this stage feeds. Deals inherit the category from "
            "their current stage on every transition (see PipelineService)."
        ),
    )
    is_locked = models.BooleanField(
        default=False,
        help_text="If True, deals cannot be dragged back from this stage (won/lost).",
    )
    business_days_limit = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Alert when a deal has been in this stage longer than N business days.",
    )
    color = models.CharField(
        max_length=9,  # supports #RRGGBB + #RRGGBBAA
        default="#3b82f6",
        help_text="Hex color used by the pipeline UI (default Tailwind blue-500).",
    )
    icon = models.CharField(
        max_length=64,
        blank=True,
        default="",
        help_text="Optional icon name (lucide/heroicons) for the pipeline UI.",
    )

    class Meta:
        db_table = "deals_stage"
        verbose_name = "stage"
        verbose_name_plural = "stages"
        unique_together = (("pipeline", "name"),)
        ordering = ["order", "id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(probability__gte=0.0) & models.Q(probability__lte=100.0),
                name="stage_probability_range",
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
                name="stage_forecast_category_valid",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "deleted_at"], name="stage_tenant_deleted_idx"),
            models.Index(fields=["pipeline", "order"], name="stage_pipeline_order_idx"),
            models.Index(fields=["pipeline", "forecast_category"], name="stage_pipeline_fc_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.pipeline.name} → {self.name}"

    def clean(self) -> None:  # type: ignore[override]
        super().clean()
        if self.is_won_stage and self.is_lost_stage:
            raise ValidationError("A stage cannot be both won and lost.")
        if self.is_won_stage or self.is_lost_stage:
            self.is_closed = True
        if self.is_won_stage and self.probability != 100.0:
            raise ValidationError("Won stages must have probability=100.")
        if self.is_lost_stage and self.probability != 0.0:
            raise ValidationError("Lost stages must have probability=0.")
        # Closed/won stages default to the ``closed`` forecast category; lost
        # stages default to ``omitted`` so they fall out of the forecast.
        if self.is_won_stage and self.forecast_category != FORECAST_CATEGORY_CLOSED:
            raise ValidationError("Won stages must use the 'closed' forecast category.")
        if self.is_lost_stage and self.forecast_category != FORECAST_CATEGORY_OMITTED:
            raise ValidationError("Lost stages must use the 'omitted' forecast category.")

    def save(self, *args: Any, **kwargs: Any) -> None:  # type: ignore[no-untyped-def]
        """Auto-derive ``is_closed`` from ``is_won_stage`` / ``is_lost_stage``.

        ``clean()`` is only invoked by full-clean flows (e.g. model forms);
        raw ``save()`` skips it. Mirroring the same derivation here keeps the
        column consistent regardless of the write path.
        """
        if self.is_won_stage or self.is_lost_stage:
            self.is_closed = True
        else:
            self.is_closed = False
        super().save(*args, **kwargs)
