"""Model-level tests for the accounts app."""

from __future__ import annotations

import pytest

from accounts.factories import AccountFactory
from accounts.models import Account
from api.factories import _current_tenant, _current_user

pytestmark = pytest.mark.django_db


def test_account_factory_creates_row(active_tenant):  # type: ignore[no-untyped-def]
    account = AccountFactory()
    assert account.pk is not None
    assert account.tenant_id == active_tenant.pk
    assert account.name.startswith("Account ")
    assert account.deleted_at is None


def test_soft_delete_hides_row_from_default_manager(active_tenant):  # type: ignore[no-untyped-def]
    account = AccountFactory()
    account.soft_delete()
    assert Account.objects.filter(pk=account.pk).count() == 0
    assert Account.all_objects.filter(pk=account.pk).count() == 1
    assert account.is_deleted


def test_restore_recovers_row(active_tenant):  # type: ignore[no-untyped-def]
    account = AccountFactory()
    account.soft_delete()
    account.restore()
    assert Account.objects.filter(pk=account.pk).count() == 1
    assert not account.is_deleted


def test_account_str(active_tenant):  # type: ignore[no-untyped-def]
    account = AccountFactory(name="Acme Inc.")
    assert str(account) == "Acme Inc."


def test_tenant_scoping_filters_other_tenants(active_tenant):  # type: ignore[no-untyped-def]
    from api.factories import OrganizationFactory
    from api.managers import set_current_tenant, tenant_context

    other = OrganizationFactory(subdomain="otherorg", slug="otherorg")
    # Create a row in the OTHER tenant.
    with tenant_context(other):
        AccountFactory(name="Other Tenant Account")
    # Back in active_tenant context.
    set_current_tenant(active_tenant)
    AccountFactory(name="My Account")
    qs = Account.objects.all()
    names = sorted(a.name for a in qs)
    assert names == ["My Account"]


def test_check_constraint_rejects_invalid_account_type(active_tenant):  # type: ignore[no-untyped-def]
    from django.db import IntegrityError

    account = AccountFactory.build(account_type="bogus")
    account.tenant = _current_tenant()
    account.owner = _current_user()
    with pytest.raises(IntegrityError):
        account.save()


def test_unique_account_number_per_tenant(active_tenant):  # type: ignore[no-untyped-def]
    from django.db import IntegrityError

    a1 = AccountFactory(account_number="UNIQUE-1")
    # Same tenant, same number → violation.
    a2 = AccountFactory.build(account_number="UNIQUE-1", tenant=a1.tenant, owner=a1.owner)
    with pytest.raises(IntegrityError):
        a2.save()
