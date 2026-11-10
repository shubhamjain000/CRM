"""Service layer for the template_builder app.

Two public functions:

* :func:`render_html` — render a template string + a data dict using
  Django's template engine. Autoescape is off (templates are trusted
  HTML); sandbox callers must sanitize user-supplied input.
* :func:`preview_data` — return a sample data dict for the given
  category so the ``preview`` action can render without a payload.
"""

from __future__ import annotations

from typing import Any

from django.template import Context, Template

from .models import PDF_INVOICE, PDF_PROPOSAL, PDF_QUOTE, PDF_CONTRACT

###############################################################################
# Sample preview data per PDF category
###############################################################################


_PREVIEW_DATA: dict[str, dict[str, Any]] = {
    PDF_QUOTE: {
        "number": "Q-0001",
        "date": "2025-01-15",
        "customer": {"name": "Acme Corp", "email": "buyer@acme.com"},
        "lines": [
            {"description": "Widget A", "qty": 2, "price": "100.00", "total": "200.00"},
            {"description": "Widget B", "qty": 1, "price": "50.00", "total": "50.00"},
        ],
        "subtotal": "250.00",
        "tax": "25.00",
        "total": "275.00",
    },
    PDF_INVOICE: {
        "number": "INV-0001",
        "date": "2025-01-20",
        "due_date": "2025-02-20",
        "customer": {"name": "Globex Inc", "email": "ap@globex.com"},
        "lines": [
            {"description": "Consulting", "qty": 10, "price": "200.00", "total": "2000.00"},
        ],
        "subtotal": "2000.00",
        "tax": "200.00",
        "total": "2200.00",
    },
    PDF_CONTRACT: {
        "title": "Master Services Agreement",
        "effective_date": "2025-01-01",
        "parties": ["Acme Corp", "Foundation Platform"],
        "term_months": 12,
        "amount": "120000.00",
    },
    PDF_PROPOSAL: {
        "title": "Q1 Marketing Campaign",
        "client": "Initech",
        "summary": "Multi-channel lead-gen program.",
        "objectives": ["10k new leads", "30% MQL→SQL conversion"],
        "budget": "50000.00",
    },
}


def preview_data(category: str) -> dict[str, Any]:  # type: ignore[no-untyped-def]
    """Return the sample data dict for ``category`` (default = quote)."""
    return dict(_PREVIEW_DATA.get(category, _PREVIEW_DATA[PDF_QUOTE]))


###############################################################################
# render_html
###############################################################################


def render_html(
    template_source: str, data: dict[str, Any] | None = None
) -> str:
    """Render ``template_source`` (a Django template string) with ``data``.

    Autoescape is disabled — the template source is trusted (created
    by tenant admins via the template builder UI). User-supplied
    dynamic values injected via ``data`` should be pre-sanitised by
    the caller.
    """
    template = Template(template_source)
    ctx = Context(data or {})
    ctx.template.engine.autoescape = False
    return template.render(ctx)


__all__ = [
    "PDF_CONTRACT",
    "PDF_INVOICE",
    "PDF_PROPOSAL",
    "PDF_QUOTE",
    "preview_data",
    "render_html",
]
