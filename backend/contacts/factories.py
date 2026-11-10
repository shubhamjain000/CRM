"""factory_boy factories for the contacts app."""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from accounts.factories import AccountFactory
from api.factories import _current_tenant, _current_user
from contacts.models import Contact


class ContactFactory(DjangoModelFactory):
    class Meta:
        model = Contact

    tenant = factory.LazyFunction(_current_tenant)
    first_name = factory.Faker("first_name")
    last_name = factory.Faker("last_name")
    account = factory.SubFactory(AccountFactory)
    title = factory.Faker("job")
    emails = factory.LazyFunction(lambda: [{"email": "contact@example.com", "type": "work"}])
    phones = factory.LazyFunction(lambda: [{"phone": "+15555550100", "type": "work"}])
    addresses = factory.LazyFunction(lambda: [{"city": "SF", "country": "US"}])
    social_profiles = factory.LazyFunction(dict)
    birthday = None
    department = "Sales"
    lead_source = "web"
    owner = factory.LazyFunction(_current_user)
    do_not_call = False
    email_opt_out = False
