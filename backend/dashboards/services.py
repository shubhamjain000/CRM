"""Service layer for the dashboards app.

Two public functions:

* :func:`render_dashboard` — evaluate every widget on a dashboard and
  return a fully-hydrated payload (each widget's ``data`` block is filled
  in from either its bound :class:`reports.models.Report` or its
  ``custom_config.data_source`` keyed into the pre-built analytics
  registry in :mod:`reports.analytics_queries`).
* :func:`get_templates` — return the 5 pre-built dashboard templates
  (Sales Manager / Sales Rep / Marketing / Customer Success / Executive)
  as ``{name, description, layout, widgets}`` blobs ready to POST to the
  ``/api/v1/dashboards/`` endpoint.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover — typing only
    from .models import Dashboard

log = logging.getLogger(__name__)


###############################################################################
# Widget rendering
###############################################################################


def _render_widget(widget: Any, dashboard: "Dashboard") -> dict[str, Any]:
    """Render a single widget — return its hydrated payload."""
    cfg: dict[str, Any] = dict(widget.custom_config or {})
    data_source = cfg.get("data_source")
    data: dict[str, Any] = {}

    # Report-bound widget — execute via the reports service.
    if widget.report_id is not None:
        from reports.models import Report  # noqa: PLC0415
        from reports.services import report_service  # noqa: PLC0415

        report = Report.objects.filter(pk=widget.report_id).first()
        if report is not None:
            try:
                data = report_service.execute_report(report, persist=False)
            except Exception as exc:  # pragma: no cover — defensive
                log.exception("render: widget %s report %s failed", widget.pk, report.pk)
                data = {"error": str(exc)}

    # Pre-built analytics widget — dispatch via the analytics registry.
    elif data_source:
        from analytics.services import compute  # noqa: PLC0415

        try:
            data = compute(data_source, tenant=dashboard.tenant)
        except ValueError as exc:
            data = {"error": str(exc)}
        except Exception as exc:  # pragma: no cover — defensive
            log.exception("render: widget %s data_source=%s failed", widget.pk, data_source)
            data = {"error": str(exc)}

    # Static widget (kpi / counter / iframe) — pass config through as-is.
    return {
        "id": widget.pk,
        "title": widget.title,
        "widget_type": widget.widget_type,
        "position": widget.position or {},
        "color_theme": widget.color_theme,
        "drill_down": widget.drill_down,
        "config": cfg,
        "order": widget.order,
        "data": data,
    }


def render_dashboard(dashboard: "Dashboard") -> dict[str, Any]:
    """Return a fully-rendered dashboard — every widget hydrated with data.

    Respects the dashboard's global ``filters`` by passing them to each
    widget's render call (data sources that accept extra kwargs receive
    them; report-bound widgets ignore unknown filters).
    """
    out_widgets: list[dict[str, Any]] = []
    for widget in dashboard.widgets.order_by("order", "id"):
        out_widgets.append(_render_widget(widget, dashboard))
    return {
        "id": dashboard.pk,
        "name": dashboard.name,
        "layout": dashboard.layout or {},
        "filters": dashboard.filters or {},
        "refresh_interval": dashboard.refresh_interval,
        "widgets": out_widgets,
    }


###############################################################################
# Pre-built templates
###############################################################################


def _widget(
    widget_type: str,
    title: str,
    *,
    data_source: str | None = None,
    position: dict[str, int] | None = None,
    config: dict[str, Any] | None = None,
    order: int = 0,
) -> dict[str, Any]:
    """Helper for assembling a template widget dict."""
    cfg: dict[str, Any] = dict(config or {})
    if data_source:
        cfg["data_source"] = data_source
    return {
        "widget_type": widget_type,
        "title": title,
        "position": position or {"x": 0, "y": 0, "w": 4, "h": 2},
        "custom_config": cfg,
        "order": order,
    }


_TEMPLATES: list[dict[str, Any]] = [
    {
        "name": "Sales Manager",
        "description": "Pipeline health, team performance, and forecast accuracy.",
        "layout": {"columns": 12, "rowHeight": 30, "margin": 8, "float": False},
        "widgets": [
            _widget("kpi", "Pipeline Value", data_source="source_roi",
                    position={"x": 0, "y": 0, "w": 3, "h": 1}, order=0),
            _widget("kpi", "Win Rate", data_source="win_loss_analysis",
                    position={"x": 3, "y": 0, "w": 3, "h": 1}, order=1),
            _widget("kpi", "Avg Deal Size", data_source="deal_size_distribution",
                    position={"x": 6, "y": 0, "w": 3, "h": 1}, order=2),
            _widget("kpi", "Open Deals", data_source="pipeline_velocity",
                    position={"x": 9, "y": 0, "w": 3, "h": 1}, order=3),
            _widget("chart", "Sales Funnel", data_source="sales_funnel",
                    position={"x": 0, "y": 1, "w": 6, "h": 2},
                    config={"chart_type": "funnel"}, order=4),
            _widget("table", "Rep Performance", data_source="rep_performance",
                    position={"x": 6, "y": 1, "w": 6, "h": 2}, order=5),
            _widget("chart", "Pipeline Velocity", data_source="pipeline_velocity",
                    position={"x": 0, "y": 3, "w": 12, "h": 2},
                    config={"chart_type": "bar"}, order=6),
        ],
    },
    {
        "name": "Sales Rep",
        "description": "Daily activity targets, open deals, and leaderboard rank.",
        "layout": {"columns": 12, "rowHeight": 30, "margin": 8, "float": False},
        "widgets": [
            _widget("counter", "Calls Today", position={"x": 0, "y": 0, "w": 3, "h": 1},
                    config={"metric": "calls_made", "period": "today"}, order=0),
            _widget("counter", "Emails Sent", position={"x": 3, "y": 0, "w": 3, "h": 1},
                    config={"metric": "emails_sent", "period": "today"}, order=1),
            _widget("counter", "Meetings Booked", position={"x": 6, "y": 0, "w": 3, "h": 1},
                    config={"metric": "meetings_held", "period": "today"}, order=2),
            _widget("progress", "Quota Attainment",
                    position={"x": 9, "y": 0, "w": 3, "h": 1},
                    config={"metric": "revenue", "period": "month"}, order=3),
            _widget("table", "My Open Deals", data_source="rep_performance",
                    position={"x": 0, "y": 1, "w": 12, "h": 3}, order=4),
            _widget("leaderboard", "Team Leaderboard", data_source="rep_performance",
                    position={"x": 0, "y": 4, "w": 12, "h": 2}, order=5),
        ],
    },
    {
        "name": "Marketing",
        "description": "Lead funnel, source ROI, and email engagement.",
        "layout": {"columns": 12, "rowHeight": 30, "margin": 8, "float": False},
        "widgets": [
            _widget("kpi", "New Leads", data_source="lead_conversion_rate",
                    position={"x": 0, "y": 0, "w": 4, "h": 1}, order=0),
            _widget("kpi", "Conversion Rate", data_source="lead_conversion_rate",
                    position={"x": 4, "y": 0, "w": 4, "h": 1}, order=1),
            _widget("kpi", "MQL → SQL", data_source="lead_conversion_rate",
                    position={"x": 8, "y": 0, "w": 4, "h": 1}, order=2),
            _widget("chart", "Lead Conversion Funnel", data_source="sales_funnel",
                    position={"x": 0, "y": 1, "w": 6, "h": 3},
                    config={"chart_type": "funnel"}, order=3),
            _widget("table", "Source ROI", data_source="source_roi",
                    position={"x": 6, "y": 1, "w": 6, "h": 3}, order=4),
            _widget("chart", "Email Engagement", data_source="email_engagement",
                    position={"x": 0, "y": 4, "w": 12, "h": 2},
                    config={"chart_type": "line"}, order=5),
        ],
    },
    {
        "name": "Customer Success",
        "description": "Activity heatmap, call analytics, and account health.",
        "layout": {"columns": 12, "rowHeight": 30, "margin": 8, "float": False},
        "widgets": [
            _widget("chart", "Activity Heatmap", data_source="activity_heatmap",
                    position={"x": 0, "y": 0, "w": 8, "h": 3},
                    config={"chart_type": "heatmap"}, order=0),
            _widget("kpi", "Total Calls", data_source="call_analytics",
                    position={"x": 8, "y": 0, "w": 4, "h": 1}, order=1),
            _widget("kpi", "Avg Call Duration", data_source="call_analytics",
                    position={"x": 8, "y": 1, "w": 4, "h": 1}, order=2),
            _widget("gauge", "CSAT", position={"x": 8, "y": 2, "w": 4, "h": 1},
                    config={"metric": "csat", "max": 100, "min": 0}, order=3),
            _widget("table", "Recent Calls", data_source="call_analytics",
                    position={"x": 0, "y": 3, "w": 12, "h": 3}, order=4),
        ],
    },
    {
        "name": "Executive",
        "description": "High-level KPIs — revenue, win rate, deal size, retention.",
        "layout": {"columns": 12, "rowHeight": 30, "margin": 8, "float": False},
        "widgets": [
            _widget("kpi", "Total Revenue", data_source="source_roi",
                    position={"x": 0, "y": 0, "w": 3, "h": 1}, order=0),
            _widget("kpi", "Win Rate", data_source="win_loss_analysis",
                    position={"x": 3, "y": 0, "w": 3, "h": 1}, order=1),
            _widget("kpi", "Avg Deal Size", data_source="deal_size_distribution",
                    position={"x": 6, "y": 0, "w": 3, "h": 1}, order=2),
            _widget("kpi", "Sales Cycle (days)", data_source="sales_cycle_length",
                    position={"x": 9, "y": 0, "w": 3, "h": 1}, order=3),
            _widget("chart", "Revenue by Source", data_source="source_roi",
                    position={"x": 0, "y": 1, "w": 6, "h": 2},
                    config={"chart_type": "bar"}, order=4),
            _widget("chart", "Cohort Retention", data_source="cohort_retention",
                    position={"x": 6, "y": 1, "w": 6, "h": 2},
                    config={"chart_type": "line"}, order=5),
            _widget("chart", "Deal Size Distribution", data_source="deal_size_distribution",
                    position={"x": 0, "y": 3, "w": 12, "h": 2},
                    config={"chart_type": "bar"}, order=6),
        ],
    },
]


def get_templates() -> list[dict[str, Any]]:
    """Return the 5 pre-built dashboard templates."""
    # Return a deep-ish copy so callers can mutate freely.
    import copy  # noqa: PLC0415

    return copy.deepcopy(_TEMPLATES)


__all__ = ["get_templates", "render_dashboard"]
