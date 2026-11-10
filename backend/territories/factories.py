"""factory_boy factories for the territories app."""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant, _current_user

from .models import Territory, TerritoryMember


class TerritoryFactory(DjangoModelFactory):
    """Factory for :class:`Territory`."""

    class Meta:
        model = Territory

    tenant = factory.LazyFunction(_current_tenant)
    name = factory.Sequence(lambda n: f"Territory {n}")
    rules = factory.Dict({"module": "lead", "strategy": "round_robin", "filters": {}})
    manager = factory.LazyFunction(_current_user)
    parent = None
    is_active = True


class TerritoryMemberFactory(DjangoModelFactory):
    """Factory for :class:`TerritoryMember`."""

    class Meta:
        model = TerritoryMember

    tenant = factory.LazyFunction(_current_tenant)
    territory = factory.SubFactory(TerritoryFactory)
    user = factory.LazyFunction(_current_user)


__all__ = ["TerritoryFactory", "TerritoryMemberFactory"]
