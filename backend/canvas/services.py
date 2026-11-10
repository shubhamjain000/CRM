"""Service layer for the canvas app.

Three public surfaces:

* :func:`get_theme_for_tenant` — get-or-create the singleton
  :class:`CanvasTheme` for ``tenant``.
* :func:`get_prebuilt_templates` — return the list of pre-built theme
  templates (Ocean, Forest, Sunset, Slate, Candy).
* :func:`preview_theme` — given a base theme + an overrides dict,
  return the computed CSS string (without persisting anything).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .models import CanvasTheme

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization


###############################################################################
# get_theme_for_tenant
###############################################################################


def get_theme_for_tenant(tenant: "Organization") -> CanvasTheme:  # type: ignore[no-untyped-def]
    """Get-or-create the singleton theme for ``tenant``."""
    theme, _ = CanvasTheme.objects.get_or_create(tenant=tenant)
    return theme


###############################################################################
# Pre-built templates
###############################################################################


PREBUILT_TEMPLATES: list[dict[str, Any]] = [
    {
        "id": "ocean",
        "name": "Ocean",
        "primary_color": "#0ea5e9",
        "accent_color": "#6366f1",
        "font_family": "Inter",
        "border_radius": 8,
        "density": "comfortable",
        "sidebar_style": "light",
    },
    {
        "id": "forest",
        "name": "Forest",
        "primary_color": "#10b981",
        "accent_color": "#84cc16",
        "font_family": "Inter",
        "border_radius": 6,
        "density": "comfortable",
        "sidebar_style": "dark",
    },
    {
        "id": "sunset",
        "name": "Sunset",
        "primary_color": "#f97316",
        "accent_color": "#ec4899",
        "font_family": "Inter",
        "border_radius": 12,
        "density": "cozy",
        "sidebar_style": "colored",
    },
    {
        "id": "slate",
        "name": "Slate",
        "primary_color": "#475569",
        "accent_color": "#0f172a",
        "font_family": "Inter",
        "border_radius": 4,
        "density": "compact",
        "sidebar_style": "dark",
    },
    {
        "id": "candy",
        "name": "Candy",
        "primary_color": "#ec4899",
        "accent_color": "#a855f7",
        "font_family": "Inter",
        "border_radius": 16,
        "density": "cozy",
        "sidebar_style": "light",
    },
]


def get_prebuilt_templates() -> list[dict[str, Any]]:  # type: ignore[no-untyped-def]
    """Return the list of pre-built theme templates."""
    return list(PREBUILT_TEMPLATES)


###############################################################################
# preview_theme
###############################################################################


def preview_theme(
    theme: CanvasTheme, overrides: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Return a preview object for ``theme`` with ``overrides`` applied.

    The preview contains the merged values plus a computed CSS string
    that the frontend can inject into a sandboxed iframe.
    """
    merged = {
        "primary_color": theme.primary_color,
        "accent_color": theme.accent_color,
        "font_family": theme.font_family,
        "border_radius": theme.border_radius,
        "density": theme.density,
        "sidebar_style": theme.sidebar_style,
        "logo_url": theme.logo_url,
        "custom_css": theme.custom_css,
    }
    if overrides:
        for key, value in overrides.items():
            if key in merged and value is not None:
                merged[key] = value

    radius_var = f"{merged['border_radius']}px"
    density_pad = {
        "compact": "4px 8px",
        "comfortable": "8px 12px",
        "cozy": "12px 16px",
    }.get(merged["density"], "8px 12px")

    css = (
        f":root {{\n"
        f"  --primary: {merged['primary_color']};\n"
        f"  --accent: {merged['accent_color']};\n"
        f"  --font: '{merged['font_family']}', sans-serif;\n"
        f"  --radius: {radius_var};\n"
        f"  --density-pad: {density_pad};\n"
        f"}}\n"
        f"body {{ font-family: var(--font); }}\n"
        f".btn-primary {{ background: var(--primary); color: #fff; "
        f"border-radius: var(--radius); padding: var(--density-pad); }}\n"
    )
    if merged["custom_css"]:
        css += f"\n/* custom */\n{merged['custom_css']}\n"
    return {"theme": merged, "css": css}


__all__ = [
    "PREBUILT_TEMPLATES",
    "get_prebuilt_templates",
    "get_theme_for_tenant",
    "preview_theme",
]
