"""factory_boy factories for the accounts app.

Used by the seed command and the test-suite. ``tenant`` and ``owner`` are
lazily attached from the thread-local tenant (set via ``tenant_context``) or
created on demand by the shared factories in :mod:`api.factories`.
"""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from accounts.models import Account
from api.factories import _current_tenant, _current_user


class AccountFactory(DjangoModelFactory):
    class Meta:
        model = Account

    tenant = factory.LazyFunction(_current_tenant)
    name = factory.Sequence(lambda n: f"Account {n}")
    account_number = factory.Sequence(lambda n: f"ACC-{n:05d}")
    account_type = "customer"
    industry = "Technology"
    annual_revenue = None
    employees = factory.Faker("random_int", min=1, max=5000)
    website = "https://example.com"
    billing_address = factory.LazyFunction(lambda: {"line1": "1 Market St", "city": "SF", "country": "US"})
    shipping_address = factory.LazyFunction(dict)
    parent_account = None
    rating = "warm"
    description = factory.Faker("sentence")
    tags = factory.LazyFunction(lambda: ["enterprise"])
    owner = factory.LazyFunction(_current_user)
