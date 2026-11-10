"""Service layer for the analytics app.

Thin façade over :mod:`reports.analytics_queries` — the dashboards layer is
intentionally light so the heavy lifting (ORM aggregation, JSON shaping)
lives in one place and is reused by both the reports builder and the
analytics dashboards.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from reports import analytics_queries

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization


###############################################################################
# Pre-built analytics dispatch
###############################################################################

#: Maps widget ``data_source`` (string) → callable returning a JSON payload.
_ANALYTICS_REGISTRY: dict[str, Any] = {
    "sales_funnel": analytics_queries.sales_funnel,
    "win_loss_analysis": analytics_queries.win_loss_analysis,
    "lead_conversion_rate": analytics_queries.lead_conversion_rate,
    "sales_cycle_length": analytics_queries.sales_cycle_length,
    "deal_size_distribution": analytics_queries.deal_size_distribution,
    "rep_performance": analytics_queries.rep_performance,
    "activity_heatmap": analytics_queries.activity_heatmap,
    "pipeline_velocity": analytics_queries.pipeline_velocity,
    "source_roi": analytics_queries.source_roi,
    "email_engagement": analytics_queries.email_engagement,
    "call_analytics": analytics_queries.call_analytics,
    "cohort_retention": analytics_queries.cohort_retention,
}


def list_available() -> list[str]:
    """Return the names of every pre-built analytics dataset."""
    return sorted(_ANALYTICS_REGISTRY.keys())


def compute(
    data_source: str,
    tenant: "Organization | None" = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """Dispatch ``data_source`` to the matching analytics function."""
    func = _ANALYTICS_REGISTRY.get(data_source)
    if func is None:
        raise ValueError(
            f"compute: unknown data_source {data_source!r}. "
            f"Available: {sorted(_ANALYTICS_REGISTRY)}"
        )
    return func(tenant=tenant, **kwargs)


###############################################################################
# Dashboard rendering
###############################################################################


def render_dashboard(dashboard_id: int) -> dict[str, Any]:
    """Return a fully-rendered dashboard — every widget hydrated with data.

    For widgets backed by a :class:`reports.models.Report`, the report is
    executed via :class:`reports.services.ReportService`. For widgets with a
    ``data_source`` in :data:`_ANALYTICS_REGISTRY`, the matching pre-built
    analytics function is invoked. Widgets whose config has neither are
    returned with an empty ``data`` payload so the UI can render a
    placeholder.
    """
    from analytics.models import Dashboard  # noqa: PLC0415
    from reports.services import report_service  # noqa: PLC0415

    dashboard = Dashboard.objects.get(pk=dashboard_id)
    out_widgets: list[dict[str, Any]] = []
    for widget in dashboard.widgets.order_by("order", "id"):
        cfg = dict(widget.config or {})
        data_source = cfg.pop("data_source", None)
        report_id = cfg.pop("report_id", None) or widget.report_id
        data: dict[str, Any] = {}
        if report_id:
            from reports.models import Report  # noqa: PLC0415

            report = Report.objects.filter(pk=report_id).first()
            if report is not None:
                try:
                    data = report_service.execute_report(report, persist=False)
                except Exception as exc:  # pragma: no cover — defensive
                    data = {"error": str(exc)}
        elif data_source and data_source in _ANALYTICS_REGISTRY:
            try:
                data = _ANALYTICS_REGISTRY[data_source](tenant=dashboard.tenant, **cfg)
            except Exception as exc:  # pragma: no cover — defensive
                data = {"error": str(exc)}
        out_widgets.append(
            {
                "id": widget.pk,
                "title": widget.title,
                "widget_type": widget.widget_type,
                "config": cfg,
                "order": widget.order,
                "data": data,
            }
        )
    return {
        "id": dashboard.pk,
        "name": dashboard.name,
        "config": dashboard.config,
        "widgets": out_widgets,
    }


__all__ = ["compute", "list_available", "render_dashboard"]
