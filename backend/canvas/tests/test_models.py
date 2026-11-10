"""Model-layer tests for the canvas app."""

from __future__ import annotations

import pytest

from canvas.factories import CanvasThemeFactory
from canvas.models import CanvasTheme, DENSITY_COMFORTABLE, SIDEBAR_LIGHT


pytestmark = pytest.mark.django_db


def test_theme_singleton_per_tenant(active_tenant):  # type: ignore[no-untyped-def]
    CanvasThemeFactory(tenant=active_tenant)
    with pytest.raises(Exception):  # noqa: PT011 — IntegrityError
        CanvasThemeFactory(tenant=active_tenant)


def test_theme_defaults(active_tenant):  # type: ignore[no-untyped-def]
    theme = CanvasThemeFactory(tenant=active_tenant)
    assert theme.density == DENSITY_COMFORTABLE
    assert theme.sidebar_style == SIDEBAR_LIGHT
    assert theme.border_radius == 8
