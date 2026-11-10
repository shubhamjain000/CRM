"""Model-level tests for the leads app."""

from __future__ import annotations

import pytest

from api.factories import OrganizationFactory
from api.managers import set_current_tenant, tenant_context
from leads.factories import LeadFactory
from leads.models import Lead

pytestmark = pytest.mark.django_db


def test_lead_factory_creates_row(active_tenant):  # type: ignore[no-untyped-def]
    lead = LeadFactory()
    assert lead.pk is not None
    assert lead.tenant_id == active_tenant.pk
    assert lead.lead_status == "new"
    assert lead.is_converted is False


def test_lead_str_and_full_name(active_tenant):  # type: ignore[no-untyped-def]
    lead = LeadFactory(first_name="Ada", last_name="Lovelace")
    assert lead.full_name == "Ada Lovelace"
    assert str(lead) == "Ada Lovelace"


def test_lead_primary_email(active_tenant):  # type: ignore[no-untyped-def]
    lead = LeadFactory(emails=[{"email": "ada@example.com", "type": "work"}])
    assert lead.primary_email() == "ada@example.com"


def test_soft_delete(active_tenant):  # type: ignore[no-untyped-def]
    lead = LeadFactory()
    lead.soft_delete()
    assert Lead.objects.filter(pk=lead.pk).count() == 0
    assert Lead.all_objects.filter(pk=lead.pk).count() == 1


def test_check_constraint_rejects_invalid_status(active_tenant):  # type: ignore[no-untyped-def]
    from django.db import IntegrityError

    lead = LeadFactory.build(lead_status="bogus")
    lead.tenant = active_tenant
    with pytest.raises(IntegrityError):
        lead.save()


def test_check_constraint_rejects_bad_score(active_tenant):  # type: ignore[no-untyped-def]
    from django.db import IntegrityError

    lead = LeadFactory.build(score=150.0)
    lead.tenant = active_tenant
    with pytest.raises(IntegrityError):
        lead.save()


def test_tenant_scoping_filters_other_tenants(active_tenant):  # type: ignore[no-untyped-def]
    other = OrganizationFactory(subdomain="otherorg", slug="otherorg")
    with tenant_context(other):
        LeadFactory(first_name="Other")
    set_current_tenant(active_tenant)
    LeadFactory(first_name="Mine")
    names = [l.first_name for l in Lead.objects.all()]
    assert names == ["Mine"]


def test_touch_updates_last_activity(active_tenant):  # type: ignore[no-untyped-def]
    lead = LeadFactory(last_activity=None)
    lead.touch()
    lead.refresh_from_db()
    assert lead.last_activity is not None
