"""Model-layer tests for the marketplace app."""

from __future__ import annotations

import pytest

from marketplace.models import (
    Extension,
    InstalledExtension,
    PRICING_FREE,
    STATUS_ACTIVE,
)


pytestmark = pytest.mark.django_db


def test_extension_and_install_round_trip(active_tenant):  # type: ignore[no-untyped-def]
    ext = Extension.objects.create(
        name="Zapier Bridge",
        developer="Acme",
        version="2.1.0",
        pricing=PRICING_FREE,
        is_verified=True,
        is_featured=True,
        downloads=10,
        rating=4.5,
    )
    assert ext.tenant_id is None  # global catalog row
    install = InstalledExtension.objects.create(
        tenant=active_tenant,
        extension=ext,
        config={"webhook": "x"},
        status=STATUS_ACTIVE,
    )
    assert str(ext) == "Zapier Bridge v2.1.0 (Acme)"
    assert active_tenant.slug in str(install)
    assert install.config == {"webhook": "x"}
