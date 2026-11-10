"""Service layer for the reports app.

The :class:`ReportService` translates a saved :class:`reports.models.Report`
into a Django ORM query, executes it, optionally transforms the rows into a
chart-specific payload, and exposes export + scheduling helpers.

The query builder supports:

* Field selection — list of ``{"field": "name", "alias": "Name"}``.
* Filter tree — recursive AND/OR: ``{"op": "and"|"or", "children": [...]}``
  or a leaf ``{"field": "x", "op": "eq", "value": v}``. Supported leaf
  operators: ``eq`` / ``ne`` / ``contains`` / ``startswith`` / ``endswith``
  / ``isnull`` / ``in`` / ``between`` / ``gt`` / ``lt`` / ``gte`` / ``lte``
  / ``regex``.
* Group-by + aggregates — ``sum`` / ``avg`` / ``count`` / ``count_distinct``
  / ``min`` / ``max``.
* HAVING — applied post-aggregate (same shape as filters but on alias names).
* Order-by — ``[{"field": "revenue", "dir": "desc"}, ...]``.
* Limit / offset.

The model registry (:data:`SOURCE_MODELS`) maps each ``source_model`` value
to a concrete Django model class. The mapping is resolved lazily so the
module is import-safe in test contexts that haven't migrated every CRM app.
"""

from __future__ import annotations

import csv
import io
import json
import logging
from decimal import Decimal
from typing import TYPE_CHECKING, Any, Iterable

from django.db.models import (
    Avg,
    Count,
    Max,
    Min,
    Q,
    QuerySet,
    Sum,
)
from django.utils import timezone

from .models import (
    EXEC_COMPLETED,
    EXEC_FAILED,
    EXEC_RUNNING,
    Report,
    ReportExecution,
    ReportSubscription,
)

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization, User

log = logging.getLogger(__name__)

###############################################################################
# Source-model registry
###############################################################################


def _source_models() -> dict[str, str]:
    """Map ``source_model`` value → dotted model path.

    Kept as a function (not a module-level dict) so that importing this
    module never imports the CRM apps (which keeps test isolation cheap).
    """
    return {
        "lead": "leads.Lead",
        "contact": "contacts.Contact",
        "account": "accounts.Account",
        "deal": "deals.Deal",
        "task": "tasks.Task",
        "event": "events.Event",
        "call": "calls.Call",
        "activity": "crm_ux.Activity",
    }


def _resolve_model(source: str) -> type[Any]:
    """Resolve a source-model key to a Django model class."""
    from django.apps import apps  # noqa: PLC0415

    path = _source_models().get(source)
    if path is None:
        raise ValueError(f"Unknown source_model: {source!r}")
    app_label, model_name = path.split(".")
    return apps.get_model(app_label, model_name)


###############################################################################
# Filter-tree evaluation
###############################################################################

# Leaf operator → ORM lookup suffix.
_OPERATOR_LOOKUP: dict[str, str] = {
    "eq": "",
    "ne": "",  # handled via ~Q
    "contains": "__icontains",
    "startswith": "__istartswith",
    "endswith": "__iendswith",
    "isnull": "__isnull",
    "in": "__in",
    "between": "",  # range
    "gt": "__gt",
    "lt": "__lt",
    "gte": "__gte",
    "lte": "__lte",
    "regex": "__regex",
}


def evaluate_filter_tree(tree: dict[str, Any] | None, queryset: QuerySet[Any]) -> QuerySet[Any]:
    """Recursively evaluate an AND/OR filter tree, returning a filtered queryset.

    ``tree`` shape:

    * Composite: ``{"op": "and"|"or", "children": [<tree>, ...]}``
    * Leaf:      ``{"field": "amount", "op": "gt", "value": 1000}``

    An empty / falsy tree is a no-op.
    """
    if not tree:
        return queryset
    q = _build_q(tree)
    if q is None:
        return queryset
    return queryset.filter(q)


def _build_q(node: dict[str, Any]) -> Q | None:
    """Build a single :class:`Q` object from a tree node."""
    if not isinstance(node, dict):
        return None
    op = (node.get("op") or "").lower()
    if op in ("and", "or"):
        children = node.get("children") or []
        child_qs = [q for c in children if (q := _build_q(c)) is not None]
        if not child_qs:
            return None
        if op == "and":
            q = child_qs[0]
            for extra in child_qs[1:]:
                q &= extra
        else:
            q = child_qs[0]
            for extra in child_qs[1:]:
                q |= extra
        return q
    # Leaf node.
    field = node.get("field")
    operator = (node.get("op") or "eq").lower()
    value = node.get("value")
    if not field:
        return None
    suffix = _OPERATOR_LOOKUP.get(operator, "")
    key = f"{field}{suffix}"
    if operator == "ne":
        return ~Q(**{key: value})
    if operator == "between":
        if not isinstance(value, (list, tuple)) or len(value) != 2:
            return None
        return Q(**{f"{field}__gte": value[0]}) & Q(**{f"{field}__lte": value[1]})
    return Q(**{key: value})


###############################################################################
# Query builder
###############################################################################

_AGG_FUNCS: dict[str, type[Any]] = {
    "sum": Sum,
    "avg": Avg,
    "count": Count,
    "count_distinct": Count,
    "min": Min,
    "max": Max,
}


def build_query(report: Report) -> QuerySet[Any]:
    """Construct a Django ORM queryset from a saved :class:`Report`.

    Returns the base queryset for ``report.source_model`` filtered + grouped
    + ordered + sliced according to the report's JSON config. The queryset
    is NOT evaluated — the caller (typically :func:`execute_report`) is
    responsible for materializing it.

    The returned queryset is always a ``.values()`` queryset (i.e. yields
    dicts) so :func:`execute_report` can coerce rows uniformly — either
    projected to the explicit ``fields`` list, or to ``group_by + aggregates``
    columns, or to the model's ``pk`` column when nothing else is requested.
    """
    model = _resolve_model(report.source_model)
    queryset = model.objects.all()  # type: ignore[union-attr]

    # Filters (WHERE).
    queryset = evaluate_filter_tree(report.filters, queryset)

    # Group-by + aggregates.
    group_by: list[str] = list(report.group_by or [])
    aggregates: list[dict[str, Any]] = list(report.aggregates or [])
    field_specs: list[dict[str, Any]] = list(report.fields or [])

    if group_by or aggregates:
        values_args = list(group_by)
        queryset = queryset.values(*values_args) if values_args else queryset
        annotate_kwargs: dict[str, Any] = {}
        for agg in aggregates:
            func = (agg.get("function") or "").lower()
            field = agg.get("field")
            alias = agg.get("alias") or f"{func}_{field}"
            agg_cls = _AGG_FUNCS.get(func)
            if agg_cls is None:
                continue
            if func == "count_distinct":
                annotate_kwargs[alias] = Count(field, distinct=True)
            elif func == "count":
                annotate_kwargs[alias] = Count(field or "id")
            else:
                annotate_kwargs[alias] = agg_cls(field)
        if annotate_kwargs:
            queryset = queryset.annotate(**annotate_kwargs)  # type: ignore[assignment]

        # HAVING — apply post-aggregate filters on alias names.
        if report.having:
            queryset = evaluate_filter_tree(report.having, queryset)

    elif field_specs:
        # Tabular projection — select only the requested fields.
        values_args: list[str] = []
        for spec in field_specs:
            if isinstance(spec, dict):
                values_args.append(spec.get("field") or spec.get("name") or "id")
            else:
                values_args.append(str(spec))
        queryset = queryset.values(*values_args)
    else:
        # No projection / aggregation requested — return only the pk so
        # execute_report still receives dicts.
        queryset = queryset.values("pk")

    # Order-by.
    order_by: list[dict[str, Any]] = list(report.order_by or [])
    order_keys: list[str] = []
    for spec in order_by:
        if isinstance(spec, str):
            order_keys.append(spec)
            continue
        field = spec.get("field") or spec.get("name")
        direction = (spec.get("dir") or "asc").lower()
        if field:
            order_keys.append(f"-{field}" if direction == "desc" else field)
    if order_keys:
        queryset = queryset.order_by(*order_keys)

    return queryset


###############################################################################
# Chart-data generation
###############################################################################


def _coerce(value: Any) -> Any:
    """JSON-friendly coercion (Decimal → float, datetime → isoformat)."""
    if isinstance(value, Decimal):
        return float(value)
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def generate_chart_data(report: Report, rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Transform raw ``rows`` into a chart-specific payload.

    Recognised chart types: ``bar`` / ``line`` / ``pie`` / ``funnel`` /
    ``heatmap`` / ``gauge`` / ``scatter`` / ``treemap`` / ``sankey`` /
    ``radar`` / ``waterfall``. Anything else (incl. ``none``) returns
    ``{}`` so the caller can fall back to a tabular rendering.
    """
    chart_type = (report.chart_type or "none").lower()
    if chart_type == "none" or not rows:
        return {}

    cfg = report.chart_config or {}
    label_field = cfg.get("label_field") or (next(iter(rows[0])) if rows else "label")
    value_field = cfg.get("value_field") or _pick_numeric_field(rows[0])
    group_field = cfg.get("group_field")
    x_field = cfg.get("x_field") or label_field
    y_field = cfg.get("y_field") or value_field

    if chart_type in ("bar", "line", "radar"):
        labels = [_coerce(r.get(label_field)) for r in rows]
        datasets = [
            {
                "label": cfg.get("dataset_label", value_field),
                "data": [_coerce(r.get(value_field)) for r in rows],
            }
        ]
        return {"labels": labels, "datasets": datasets}

    if chart_type == "pie":
        return {
            "labels": [_coerce(r.get(label_field)) for r in rows],
            "data": [_coerce(r.get(value_field)) for r in rows],
        }

    if chart_type == "funnel":
        return {
            "stages": [_coerce(r.get(label_field)) for r in rows],
            "values": [_coerce(r.get(value_field)) for r in rows],
        }

    if chart_type == "gauge":
        # Single scalar gauge — first row's value vs. config max.
        value = _coerce(rows[0].get(value_field)) if rows else 0
        return {
            "value": value,
            "min": cfg.get("min", 0),
            "max": cfg.get("max", 100),
            "label": cfg.get("label", value_field),
        }

    if chart_type == "heatmap":
        # Expects group_field + value_field — builds an x/y/value matrix.
        x_labels = sorted({_coerce(r.get(x_field)) for r in rows if r.get(x_field) is not None})
        y_labels = sorted({_coerce(r.get(y_field)) for r in rows if r.get(y_field) is not None})
        index = {(r.get(x_field), r.get(y_field)): _coerce(r.get(value_field)) for r in rows}
        matrix = [
            [index.get((x, y), 0) for y in y_labels]
            for x in x_labels
        ]
        return {"x": x_labels, "y": y_labels, "values": matrix}

    if chart_type == "scatter":
        return {
            "points": [
                {"x": _coerce(r.get(x_field)), "y": _coerce(r.get(y_field))}
                for r in rows
            ]
        }

    if chart_type == "treemap":
        return {
            "items": [
                {"label": _coerce(r.get(label_field)), "value": _coerce(r.get(value_field))}
                for r in rows
            ]
        }

    if chart_type == "sankey":
        return {
            "links": [
                {
                    "source": _coerce(r.get(x_field)),
                    "target": _coerce(r.get(group_field or "target")),
                    "value": _coerce(r.get(value_field)),
                }
                for r in rows
            ]
        }

    if chart_type == "waterfall":
        return {
            "labels": [_coerce(r.get(label_field)) for r in rows],
            "values": [_coerce(r.get(value_field)) for r in rows],
            "cumulative": _running_sum([_coerce(r.get(value_field)) for r in rows]),
        }

    return {}


def _pick_numeric_field(row: dict[str, Any]) -> str:
    """Return the first numeric-looking field name in ``row``."""
    for k, v in row.items():
        if isinstance(v, (int, float, Decimal)):
            return k
    return next(iter(row.keys()), "value")


def _running_sum(values: list[Any]) -> list[float]:
    """Cumulative sum of a list of numeric values."""
    total = 0.0
    out: list[float] = []
    for v in values:
        try:
            total += float(v)
        except (TypeError, ValueError):
            pass
        out.append(total)
    return out


###############################################################################
# Execute + export
###############################################################################


class ReportService:
    """Stateless façade around :func:`build_query` / :func:`generate_chart_data`.

    Grouping the entry-points on a class keeps the public surface stable
    while the underlying helpers evolve.
    """

    def execute_report(
        self,
        report: Report,
        *,
        limit: int | None = None,
        offset: int | None = None,
        user: "User | None" = None,
        persist: bool = True,
    ) -> dict[str, Any]:
        """Execute ``report`` and return ``{columns, rows, total, chart_data}``.

        When ``persist=True`` a :class:`ReportExecution` audit row is written
        capturing status / row_count / execution_time_ms / result_data.
        """
        execution: ReportExecution | None = None
        started = timezone.now()
        if persist:
            execution = ReportExecution.objects.create(
                tenant=report.tenant,
                report=report,
                executed_by=user,
                status=EXEC_RUNNING,
                started_at=started,
            )

        try:
            queryset = build_query(report)
            eff_limit = report.limit if limit is None else limit
            eff_offset = report.offset if offset is None else offset
            if eff_offset:
                queryset = queryset[eff_offset:]
            if eff_limit:
                queryset = queryset[:eff_limit]
            raw_rows = [_coerce_row(dict(r)) for r in queryset]
            rows, columns = self._apply_aliases(report, raw_rows)
            total = len(rows)
            chart_data = generate_chart_data(report, rows)
            elapsed_ms = int((timezone.now() - started).total_seconds() * 1000)
            if execution is not None:
                execution.status = EXEC_COMPLETED
                execution.row_count = total
                execution.execution_time_ms = elapsed_ms
                execution.result_data = {"columns": columns, "rows": rows[:200]}
                execution.completed_at = timezone.now()
                execution.save(
                    update_fields=[
                        "status",
                        "row_count",
                        "execution_time_ms",
                        "result_data",
                        "completed_at",
                    ]
                )
            report.last_run_at = timezone.now()
            if persist:
                report.save(update_fields=["last_run_at", "updated_at"])
            return {
                "columns": columns,
                "rows": rows,
                "total": total,
                "chart_data": chart_data,
            }
        except Exception as exc:
            log.exception("execute_report: report %s failed", report.pk)
            if execution is not None:
                execution.status = EXEC_FAILED
                execution.error_message = str(exc)
                execution.completed_at = timezone.now()
                execution.save(
                    update_fields=["status", "error_message", "completed_at"]
                )
            raise

    def _derive_columns(self, report: Report) -> list[str]:
        """Fallback column list when the queryset returned no rows."""
        cols = [f.get("alias") or f.get("field") for f in (report.fields or [])]
        cols += [a.get("alias") for a in (report.aggregates or []) if a.get("alias")]
        cols += list(report.group_by or [])
        return cols

    def _apply_aliases(
        self, report: Report, raw_rows: list[dict[str, Any]]
    ) -> tuple[list[dict[str, Any]], list[str]]:
        """Rename raw row keys to their declared aliases.

        Returns ``(rows, columns)`` where ``columns`` is the canonical
        ordered list (alias-first for ``fields`` config, then group_by +
        aggregate aliases). When no rows are returned, falls back to
        :meth:`_derive_columns` for the column list.
        """
        field_specs: list[dict[str, Any]] = list(report.fields or [])
        # Build alias map: field_name -> alias (only when alias is set + distinct).
        alias_map: dict[str, str] = {}
        ordered_cols: list[str] = []
        for spec in field_specs:
            if not isinstance(spec, dict):
                continue
            field = spec.get("field")
            alias = spec.get("alias")
            if field and alias and alias not in alias_map.values():
                alias_map[field] = alias
                ordered_cols.append(alias)
        # Add aggregate aliases + group_by keys (only those not already present).
        for agg in (report.aggregates or []):
            if isinstance(agg, dict) and agg.get("alias"):
                if agg["alias"] not in ordered_cols:
                    ordered_cols.append(agg["alias"])
        for gb in (report.group_by or []):
            label = alias_map.get(gb, gb)
            if label not in ordered_cols:
                ordered_cols.append(label)

        if not raw_rows:
            return [], ordered_cols or self._derive_columns(report)

        rows: list[dict[str, Any]] = []
        for raw in raw_rows:
            new_row: dict[str, Any] = {}
            for k, v in raw.items():
                new_row[alias_map.get(k, k)] = v
            rows.append(new_row)

        if not ordered_cols:
            ordered_cols = list(rows[0].keys())
        return rows, ordered_cols

    def export_report(
        self,
        report: Report,
        *,
        fmt: str = "csv",
        limit: int | None = None,
    ) -> bytes:
        """Export ``report`` to ``csv`` / ``xlsx`` / ``pdf`` / ``json``.

        ``xlsx`` / ``pdf`` paths are stubbed — they require openpyxl /
        reportlab, which aren't hard dependencies. The function returns the
        raw bytes so a viewset can stream it as a ``FileResponse``.
        """
        result = self.execute_report(report, limit=limit, persist=False)
        rows = result["rows"]
        columns = result["columns"]
        fmt_lower = (fmt or "csv").lower()

        if fmt_lower == "json":
            return json.dumps({"columns": columns, "rows": rows}, default=str).encode()

        if fmt_lower == "csv":
            buf = io.StringIO()
            writer = csv.writer(buf)
            writer.writerow(columns)
            for row in rows:
                writer.writerow([row.get(col, "") for col in columns])
            return buf.getvalue().encode()

        if fmt_lower == "xlsx":
            # Minimal XLSX (Excel 2003 XML / SpreadsheetML) — no openpyxl dep.
            xml = ['<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>']
            xml.append("<Workbook xmlns=\"urn:schemas-microsoft-com:office:spreadsheet\">")
            xml.append(
                '<Worksheet xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" ss:Name="Report">'
            )
            xml.append("<Table>")
            xml.append(
                "<Row>"
                + "".join(f"<Cell><Data ss:Type=\"String\">{c}</Data></Cell>" for c in columns)
                + "</Row>"
            )
            for row in rows:
                cells = []
                for col in columns:
                    v = row.get(col, "")
                    if isinstance(v, (int, float)):
                        cells.append(f'<Cell><Data ss:Type="Number">{v}</Data></Cell>')
                    else:
                        safe = str(v).replace("&", "&amp;").replace("<", "&lt;")
                        cells.append(f'<Cell><Data ss:Type="String">{safe}</Data></Cell>')
                xml.append("<Row>" + "".join(cells) + "</Row>")
            xml.append("</Table></Worksheet></Workbook>")
            return "".join(xml).encode()

        if fmt_lower == "pdf":
            # PDF is delegated to a real PDF lib at the viewset layer; we
            # return a minimal placeholder bytes payload so the contract is
            # explicit. (Production wiring: reportlab or weasyprint.)
            payload = json.dumps({"columns": columns, "rows": rows}, default=str)
            return payload.encode()

        raise ValueError(f"export_report: unsupported format {fmt!r}")

    def schedule_report(self, report: Report, *, user: "User | None" = None) -> str:
        """Schedule ``report`` for recurring e-mail delivery.

        Returns the Celery task-id (or an empty string when Celery is not
        installed — tests / dev environments may not have a broker running).
        ``report.schedule_cron`` is the source of truth for the cadence; the
        task body looks up the report, calls :meth:`execute_report`, then
        e-mails every :class:`ReportSubscription` subscriber.
        """
        if not report.schedule_cron:
            raise ValueError("schedule_report: report.schedule_cron is required.")
        try:
            from config.celery import app  # noqa: PLC0415
        except Exception:  # pragma: no cover — Celery optional in dev
            log.warning("schedule_report: Celery not available — schedule recorded only.")
            return ""
        task_name = f"reports-run-scheduled-{report.pk}"
        task = app.send_task(
            "reports.run_scheduled_report",
            kwargs={"report_id": report.pk, "user_id": user.pk if user else None},
            name=task_name,
        )
        return getattr(task, "id", "")


def _coerce_row(row: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of ``row`` with all values coerced to JSON-friendly types."""
    return {k: _coerce(v) for k, v in dict(row).items()}


###############################################################################
# Celery task entry-point (registered when Celery is installed)
###############################################################################


def run_scheduled_report(report_id: int, user_id: int | None = None) -> dict[str, Any]:
    """Celery task body — executes ``report_id`` and e-mails subscribers."""
    from api.models import User  # noqa: PLC0415

    report = Report.objects.get(pk=report_id)
    user = User.objects.filter(pk=user_id).first() if user_id else None
    service = ReportService()
    result = service.execute_report(report, user=user, persist=True)
    _email_subscribers(report, result)
    return {"report_id": report.pk, "row_count": result["total"]}


def _email_subscribers(report: Report, result: dict[str, Any]) -> None:
    """E-mail every subscriber the executed report (best-effort)."""
    subs: Iterable[ReportSubscription] = ReportSubscription.objects.filter(
        report=report, email_on_run=True
    ).select_related("user")
    if not subs:
        return
    try:
        from notifications.services import send_notification  # noqa: PLC0415
    except Exception:  # pragma: no cover — notifications app optional
        log.warning("_email_subscribers: notifications app not available.")
        return
    for sub in subs:
        try:
            send_notification(
                user=sub.user,
                template="report_executed",
                context={
                    "report_name": report.name,
                    "row_count": result["total"],
                    "report_id": report.pk,
                },
            )
        except Exception:  # pragma: no cover — defensive
            log.exception("Failed to email subscriber %s for report %s", sub.user_id, report.pk)


# Module-level singleton — the conventional way to call the service.
report_service = ReportService()


###############################################################################
# Module-level convenience wrappers
###############################################################################


def execute_report(
    report: Report,
    *,
    limit: int | None = None,
    offset: int | None = None,
    user: "User | None" = None,
    persist: bool = True,
) -> dict[str, Any]:
    """Module-level alias for :meth:`ReportService.execute_report`."""
    return report_service.execute_report(
        report, limit=limit, offset=offset, user=user, persist=persist
    )


def export_report(
    report: Report,
    *,
    fmt: str = "csv",
    limit: int | None = None,
) -> bytes:
    """Module-level alias for :meth:`ReportService.export_report`."""
    return report_service.export_report(report, fmt=fmt, limit=limit)


def schedule_report(report: Report, *, user: "User | None" = None) -> str:
    """Module-level alias for :meth:`ReportService.schedule_report`."""
    return report_service.schedule_report(report, user=user)


__all__ = [
    "ReportService",
    "build_query",
    "evaluate_filter_tree",
    "execute_report",
    "export_report",
    "generate_chart_data",
    "report_service",
    "run_scheduled_report",
    "schedule_report",
]
