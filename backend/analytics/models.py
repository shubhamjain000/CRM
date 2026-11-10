"""Database models for the analytics app (pre-built dashboards).

Both models are tenant-scoped (inherit :class:`api.models.TenantModel`):

* :class:`Dashboard` — a named collection of widgets with a layout config
  (e.g. ``{"grid": "12-col", "background": "#fff"}``). Marked ``is_default``
  to surface a tenant's primary dashboard in the UI.
* :class:`DashboardWidget` — a single chart / metric / table / funnel tile
  positioned on a dashboard. ``config`` carries position + size +
  data-source details. Optionally bound to a :class:`reports.models.Report`
  for widget types driven by a saved report.
"""

from __future__ import annotations

from django.db import models

from api.models import TenantModel, User

###############################################################################
# Constants — widget types
###############################################################################

WIDGET_CHART = "chart"
WIDGET_METRIC = "metric"
WIDGET_TABLE = "table"
WIDGET_FUNNEL = "funnel"
WIDGET_TYPE_CHOICES = [
    (WIDGET_CHART, "Chart"),
    (WIDGET_METRIC, "Metric"),
    (WIDGET_TABLE, "Table"),
    (WIDGET_FUNNEL, "Funnel"),
]


###############################################################################
# Dashboard
###############################################################################


class Dashboard(TenantModel):
    """A named dashboard with a widget layout."""

    name = models.CharField(max_length=255, db_index=True)
    config = models.JSONField(default=dict, blank=True)
    is_default = models.BooleanField(default=False, db_index=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="dashboards",
        db_index=True,
    )

    class Meta:
        db_table = "analytics_dashboard"
        verbose_name = "dashboard"
        verbose_name_plural = "dashboards"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "is_default"], name="dashboard_default_idx"),
        ]

    def __str__(self) -> str:
        return self.name


###############################################################################
# DashboardWidget
###############################################################################


class DashboardWidget(TenantModel):
    """A single tile on a :class:`Dashboard`."""

    dashboard = models.ForeignKey(
        Dashboard,
        on_delete=models.CASCADE,
        related_name="widgets",
        db_index=True,
    )
    title = models.CharField(max_length=255)
    widget_type = models.CharField(
        max_length=16, choices=WIDGET_TYPE_CHOICES, default=WIDGET_CHART, db_index=True
    )
    report = models.ForeignKey(
        "reports.Report",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="dashboard_widgets",
        db_index=True,
    )
    config = models.JSONField(default=dict, blank=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "analytics_widget"
        verbose_name = "dashboard widget"
        verbose_name_plural = "dashboard widgets"
        ordering = ["order", "id"]
        indexes = [
            models.Index(fields=["dashboard", "order"], name="widget_order_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.title} ({self.widget_type})"


__all__ = [
    "Dashboard",
    "DashboardWidget",
    "WIDGET_CHART",
    "WIDGET_FUNNEL",
    "WIDGET_METRIC",
    "WIDGET_TABLE",
    "WIDGET_TYPE_CHOICES",
]
