"""Model-layer tests for the territories app."""

from __future__ import annotations

import pytest

from territories.factories import TerritoryFactory, TerritoryMemberFactory
from territories.models import Territory, TerritoryMember


pytestmark = pytest.mark.django_db


def test_territory_unique_per_tenant(active_tenant):  # type: ignore[no-untyped-def]
    TerritoryFactory(tenant=active_tenant, name="US West")
    with pytest.raises(Exception):  # noqa: PT011 — IntegrityError
        TerritoryFactory(tenant=active_tenant, name="US West")


def test_member_unique_per_territory(active_tenant, user):  # type: ignore[no-untyped-def]
    territory = TerritoryFactory(tenant=active_tenant)
    TerritoryMemberFactory(tenant=active_tenant, territory=territory, user=user)
    with pytest.raises(Exception):  # noqa: PT011 — IntegrityError
        TerritoryMemberFactory(
            tenant=active_tenant, territory=territory, user=user
        )


def test_territory_self_reference_parent(active_tenant):  # type: ignore[no-untyped-def]
    parent = TerritoryFactory(tenant=active_tenant, name="Global")
    child = TerritoryFactory(tenant=active_tenant, name="US", parent=parent)
    assert child.parent_id == parent.pk
    assert list(parent.children.all()) == [child]
