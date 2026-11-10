"""Service layer for the layouts app.

Two public functions:

* :func:`get_fields_for_layout` — return the flattened ordered list of
  field ``api_name``s across all sections of ``layout``.
* :func:`clone_layout` — deep-copy a layout (including its sections).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from django.db import transaction

from .models import Layout, LayoutSection

if TYPE_CHECKING:  # pragma: no cover — typing only
    pass


###############################################################################
# get_fields_for_layout
###############################################################################


def get_fields_for_layout(layout: Layout) -> list[dict[str, Any]]:
    """Return the flattened field list for ``layout``.

    Output shape::

        [
            {"section": "General", "api_name": "name", "order": 0},
            {"section": "General", "api_name": "email", "order": 1},
            ...
        ]
    """
    out: list[dict[str, Any]] = []
    for section in layout.sections.order_by("order", "id"):
        for idx, name in enumerate(section.fields or []):
            out.append({
                "section": section.name,
                "api_name": name,
                "order": idx,
            })
    return out


###############################################################################
# clone_layout
###############################################################################


@transaction.atomic
def clone_layout(layout: Layout, new_name: str | None = None) -> Layout:
    """Deep-copy ``layout`` and all its sections."""
    src_sections = list(layout.sections.order_by("order", "id"))
    clone = Layout.objects.create(
        tenant=layout.tenant,
        module=layout.module,
        profile=layout.profile,
        name=new_name or f"{layout.name} (Copy)",
        config=dict(layout.config or {}),
        is_default=False,  # Clones are never the default.
    )
    for src in src_sections:
        LayoutSection.objects.create(
            tenant=layout.tenant,
            layout=clone,
            name=src.name,
            columns=src.columns,
            order=src.order,
            is_collapsible=src.is_collapsible,
            fields=list(src.fields or []),
        )
    return clone


__all__ = ["clone_layout", "get_fields_for_layout"]
