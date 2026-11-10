"""Tests for the ``seed_crm`` management command."""

from __future__ import annotations

import pytest
from django.core.management import call_command
from io import StringIO

from accounts.models import Account
from api.models import Organization, User
from contacts.models import Contact
from deals.models import Deal
from deals.models_pipeline import Pipeline, Stage
from leads.models import Lead

pytestmark = pytest.mark.django_db


def test_seed_crm_creates_demo_dataset():  # type: ignore[no-untyped-def]
    out = StringIO()
    call_command("seed_crm", stdout=out)
    output = out.getvalue()
    assert "Seed complete" in output

    org = Organization.objects.get(subdomain="demo")
    assert org.name == "Demo Org"

    admin = User.objects.get(email="admin@demo.local")
    assert admin.is_staff is True

    pipeline = Pipeline.objects.get(tenant=org, name="Sales Pipeline")
    assert pipeline.is_default is True
    assert Stage.objects.filter(pipeline=pipeline).count() == 6
    # Stages include Closed Won + Closed Lost.
    assert Stage.objects.filter(pipeline=pipeline, is_won_stage=True).count() == 1
    assert Stage.objects.filter(pipeline=pipeline, is_lost_stage=True).count() == 1

    assert Account.objects.filter(tenant=org).count() == 30
    assert Contact.objects.filter(tenant=org).count() == 50
    assert Lead.objects.filter(tenant=org).count() == 100
    assert Deal.objects.filter(tenant=org).count() == 20


def test_seed_crm_is_idempotent():  # type: ignore[no-untyped-def]
    call_command("seed_crm", stdout=StringIO())
    call_command("seed_crm", stdout=StringIO())
    org = Organization.objects.get(subdomain="demo")
    # Counts stay the same.
    assert Account.objects.filter(tenant=org).count() == 30
    assert Lead.objects.filter(tenant=org).count() == 100


def test_seed_crm_reset_clears_data():  # type: ignore[no-untyped-def]
    call_command("seed_crm", stdout=StringIO())
    assert Organization.objects.filter(subdomain="demo").exists()
    call_command("seed_crm", "--reset", stdout=StringIO())
    # After re-seed with reset, counts are back to expected.
    org = Organization.objects.get(subdomain="demo")
    assert Account.objects.filter(tenant=org).count() == 30
