"""factory_boy factories for the leads app."""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant, _current_user
from leads.models import Lead


class LeadFactory(DjangoModelFactory):
    class Meta:
        model = Lead

    tenant = factory.LazyFunction(_current_tenant)
    first_name = factory.Faker("first_name")
    last_name = factory.Faker("last_name")
    company = factory.Faker("company")
    title = factory.Faker("job")
    emails = factory.LazyFunction(lambda: [{"email": "lead@example.com", "type": "work"}])
    phones = factory.LazyFunction(lambda: [{"phone": "+15555550123", "type": "work"}])
    lead_source = "web"
    lead_status = "new"
    rating = "warm"
    industry = factory.Faker("catch_phrase")
    annual_revenue = None
    employees = factory.Faker("random_int", min=1, max=5000)
    website = "https://example.com"
    billing_address = factory.LazyFunction(lambda: {"city": "SF", "country": "US"})
    shipping_address = factory.LazyFunction(dict)
    description = factory.Faker("sentence")
    owner = factory.LazyFunction(_current_user)
    assigned_to = None
    created_by = factory.LazyFunction(_current_user)
    last_activity = None
    score = factory.Faker("random_int", min=0, max=100)
    is_converted = False
