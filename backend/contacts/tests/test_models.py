"""Model-level tests for the contacts app."""

from __future__ import annotations

import pytest

from accounts.factories import AccountFactory
from contacts.factories import ContactFactory
from contacts.models import Contact

pytestmark = pytest.mark.django_db


def test_contact_factory_creates_row(active_tenant):  # type: ignore[no-untyped-def]
    contact = ContactFactory()
    assert contact.pk is not None
    assert contact.tenant_id == active_tenant.pk
    assert contact.deleted_at is None


def test_contact_full_name(active_tenant):  # type: ignore[no-untyped-def]
    contact = ContactFactory(first_name="Ada", last_name="Lovelace")
    assert contact.full_name == "Ada Lovelace"


def test_contact_primary_email(active_tenant):  # type: ignore[no-untyped-def]
    contact = ContactFactory(emails=[{"email": "ada@example.com", "type": "work"}])
    assert contact.primary_email() == "ada@example.com"

    empty = ContactFactory(first_name="Nemo", emails=[])
    assert empty.primary_email() == ""


def test_soft_delete_hides_from_default_manager(active_tenant):  # type: ignore[no-untyped-def]
    contact = ContactFactory()
    contact.soft_delete()
    assert Contact.objects.filter(pk=contact.pk).count() == 0
    assert Contact.all_objects.filter(pk=contact.pk).count() == 1


def test_check_constraint_rejects_invalid_lead_source(active_tenant):  # type: ignore[no-untyped-def]
    from django.db import IntegrityError

    contact = ContactFactory.build(lead_source="bogus")
    contact.tenant = active_tenant
    contact.account = AccountFactory()
    with pytest.raises(IntegrityError):
        contact.save()


def test_tenant_scoping_filters_other_tenants(active_tenant):  # type: ignore[no-untyped-def]
    from api.factories import OrganizationFactory
    from api.managers import set_current_tenant, tenant_context

    other = OrganizationFactory(subdomain="otherorg", slug="otherorg")
    with tenant_context(other):
        ContactFactory(first_name="Other")
    set_current_tenant(active_tenant)
    ContactFactory(first_name="Mine")
    qs = Contact.objects.all()
    names = [c.first_name for c in qs]
    assert names == ["Mine"]
