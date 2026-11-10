"""Service-layer tests for the canvas app."""

from __future__ import annotations

from canvas.factories import CanvasThemeFactory
from canvas.services import (
    get_prebuilt_templates,
    get_theme_for_tenant,
    preview_theme,
)


pytestmark = pytest.mark.django_db


def test_get_theme_for_tenant_is_idempotent(active_tenant):  # type: ignore[no-untyped-def]
    theme1 = get_theme_for_tenant(active_tenant)
    theme2 = get_theme_for_tenant(active_tenant)
    assert theme1.pk == theme2.pk


def test_preview_theme_applies_overrides_and_renders_css(active_tenant):  # type: ignore[no-untyped-def]
    theme = CanvasThemeFactory(tenant=active_tenant, primary_color="#000000")
    preview = preview_theme(theme, {"primary_color": "#ff0000"})
    assert preview["theme"]["primary_color"] == "#ff0000"
    assert "var(--primary)" in preview["css"]
    assert "#ff0000" in preview["css"]


def test_get_prebuilt_templates_returns_5(active_tenant):  # type: ignore[no-untyped-def]
    templates = get_prebuilt_templates()
    assert len(templates) == 5
    assert {t["id"] for t in templates} == {
        "ocean", "forest", "sunset", "slate", "candy"
    }
