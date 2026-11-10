"""Database models for the dashboards app (Phase 16).

Both models are tenant-scoped (inherit :class:`api.models.TenantModel`):

* :class:`Dashboard` — a named dashboard with a GridStack-style layout,
  optional default filters, refresh interval, share list, default flag,
  and creator. The ``layout`` JSON blob holds GridStack positions /
  column counts / row height; ``filters`` is the global filter set
  applied to every widget (date range, owner, team, etc.).
* :class:`DashboardWidget` — a single tile positioned on a dashboard.
  ``position`` carries ``{x, y, w, h}`` (GridStack cell coordinates).
  ``custom_config`` carries widget-specific options (chart type, fields,
  data source, drill-down target). Optionally bound to a saved
  :class:`reports.models.Report` for widget types driven by a report.
"""

from __future__ import annotations

from django.db import models

from api.models import TenantModel, User

###############################################################################
# Constants — widget types
###############################################################################

WIDGET_KPI = "kpi"
WIDGET_CHART = "chart"
WIDGET_TABLE = "table"
WIDGET_GAUGE = "gauge"
WIDGET_LEADERBOARD = "leaderboard"
WIDGET_FUNNEL = "funnel"
WIDGET_PROGRESS = "progress"
WIDGET_COUNTER = "counter"
WIDGET_IFRAME = "iframe"

WIDGET_TYPE_CHOICES = [
    (WIDGET_KPI, "KPI"),
    (WIDGET_CHART, "Chart"),
    (WIDGET_TABLE, "Table"),
    (WIDGET_GAUGE, "Gauge"),
    (WIDGET_LEADERBOARD, "Leaderboard"),
    (WIDGET_FUNNEL, "Funnel"),
    (WIDGET_PROGRESS, "Progress"),
    (WIDGET_COUNTER, "Counter"),
    (WIDGET_IFRAME, "iFrame"),
]


###############################################################################
# Dashboard
###############################################################################


class Dashboard(TenantModel):
    """A named dashboard composed of :class:`DashboardWidget` tiles.

    ``layout`` shape (GridStack):

    ```
    {"columns": 12, "rowHeight": 30, "margin": 8, "float": false}
    ```

    ``filters`` carries global dashboard-level filters (date range, owner,
    team, segment) applied to every widget unless overridden per-widget in
    ``DashboardWidget.custom_config``.
    """

    name = models.CharField(max_length=255, db_index=True)
    layout = models.JSONField(default=dict, blank=True)
    filters = models.JSONField(default=dict, blank=True)
    refresh_interval = models.PositiveIntegerField(
        default=300,
        help_text="Auto-refresh interval in seconds. 0 = no auto-refresh.",
    )
    shared_with = models.JSONField(default=list, blank=True)
    is_default = models.BooleanField(default=False, db_index=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="dashboards_v2",
        db_index=True,
    )

    class Meta:
        db_table = "dashboards_dashboard"
        verbose_name = "dashboard"
        verbose_name_plural = "dashboards"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "is_default"], name="dsh_default_idx"),
            models.Index(fields=["tenant", "created_by"], name="dsh_creator_idx"),
        ]

    def __str__(self) -> str:
        return self.name


###############################################################################
# DashboardWidget
###############################################################################


class DashboardWidget(TenantModel):
    """A single tile positioned on a :class:`Dashboard`.

    ``position`` carries ``{"x": 0, "y": 0, "w": 4, "h": 2}`` (GridStack
    cell coordinates on a 12-col grid). ``drill_down`` carries an optional
    target — either ``{"type": "report", "id": 12}`` or
    ``{"type": "url", "url": "/deals/..."}``. ``custom_config`` is the
    widget-specific option blob (e.g. ``{"data_source": "sales_funnel",
    "chart_type": "bar"}``).
    """

    dashboard = models.ForeignKey(
        Dashboard,
        on_delete=models.CASCADE,
        related_name="widgets",
        db_index=True,
    )
    widget_type = models.CharField(
        max_length=16, choices=WIDGET_TYPE_CHOICES, default=WIDGET_CHART, db_index=True
    )
    title = models.CharField(max_length=255)
    report = models.ForeignKey(
        "reports.Report",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="dashboard_widgets_v2",
        db_index=True,
    )
    position = models.JSONField(default=dict, blank=True)
    color_theme = models.CharField(max_length=32, blank=True, default="default")
    drill_down = models.JSONField(null=True, blank=True)
    custom_config = models.JSONField(default=dict, blank=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "dashboards_widget"
        verbose_name = "dashboard widget"
        verbose_name_plural = "dashboard widgets"
        ordering = ["order", "id"]
        indexes = [
            models.Index(fields=["dashboard", "order"], name="dsh_widget_order_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.title} ({self.widget_type})"


__all__ = [
    "Dashboard",
    "DashboardWidget",
    "WIDGET_CHART",
    "WIDGET_COUNTER",
    "WIDGET_FUNNEL",
    "WIDGET_GAUGE",
    "WIDGET_IFRAME",
    "WIDGET_KPI",
    "WIDGET_LEADERBOARD",
    "WIDGET_PROGRESS",
    "WIDGET_TABLE",
    "WIDGET_TYPE_CHOICES",
]
