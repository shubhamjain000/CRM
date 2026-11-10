"""Filter tests for the accounts app.

Exercises :class:`accounts.filters.AccountFilter` directly (no HTTP layer) to
cover the django-filter wiring: exact / icontains / gt / lt / in / range /
isnull lookups, the ``tags__contains`` JSON filter, and the custom-field
filter method.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest

from django.utils import timezone

from accounts.factories import AccountFactory
from accounts.filters import AccountFilter
from accounts.models import Account
from api.factories import OrganizationFactory, UserFactory
from api.managers import set_current_tenant, tenant_context

pytestmark = pytest.mark.django_db


def _qs(query: str) -> "Account":  # type: ignore[type-arg]
    """Build an AccountFilter from a query string and return its queryset."""
    params: dict[str, str] = {}
    for pair in query.lstrip("?").split("&"):
        if not pair:
            continue
        key, _, value = pair.partition("=")
        params[key] = value
    return AccountFilter(params, queryset=Account.objects.all()).qs


def test_filter_by_name_icontains(active_tenant):  # type: ignore[no-untyped-def]
    AccountFactory(name="Acme Corp")
    AccountFactory(name="Initech LLC")
    AccountFactory(name="Globex Inc")
    qs = _qs("name=acme")
    assert qs.count() == 1
    assert qs.first().name == "Acme Corp"


def test_filter_by_account_type(active_tenant):  # type: ignore[no-untyped-def]
    AccountFactory.create_batch(2, account_type="customer")
    AccountFactory.create_batch(1, account_type="prospect")
    AccountFactory.create_batch(1, account_type="partner")
    qs = _qs("account_type=prospect")
    assert qs.count() == 1


def test_filter_by_industry_icontains(active_tenant):  # type: ignore[no-untyped-def]
    AccountFactory(industry="Technology")
    AccountFactory(industry="Healthcare")
    AccountFactory(industry="Financial Services")
    qs = _qs("industry=tech")
    assert qs.count() == 1
    assert qs.first().industry == "Technology"


def test_filter_by_rating(active_tenant):  # type: ignore[no-untyped-def]
    AccountFactory.create_batch(2, rating="hot")
    AccountFactory.create_batch(1, rating="cold")
    qs = _qs("rating=hot")
    assert qs.count() == 2


def test_filter_by_owner(active_tenant, user):  # type: ignore[no-untyped-def]
    other = UserFactory()
    AccountFactory(owner=user)
    AccountFactory(owner=other)
    qs = _qs(f"owner={user.pk}")
    assert qs.count() == 1
    assert qs.first().owner_id == user.pk


def test_filter_by_owner_in(active_tenant, user):  # type: ignore[no-untyped-def]
    other = UserFactory()
    AccountFactory(owner=user)
    AccountFactory(owner=other)
    AccountFactory(owner=other)
    qs = AccountFilter(
        {"owner_in": [str(user.pk), str(other.pk)]},
        queryset=Account.objects.all(),
    ).qs
    assert qs.count() == 3


def test_filter_by_parent_account(active_tenant):  # type: ignore[no-untyped-def]
    parent = AccountFactory()
    AccountFactory.create_batch(2, parent_account=parent)
    AccountFactory(parent_account=None)
    qs = _qs(f"parent_account={parent.pk}")
    assert qs.count() == 2


def test_filter_parent_account_isnull(active_tenant):  # type: ignore[no-untyped-def]
    parent = AccountFactory()
    AccountFactory(parent_account=parent)
    AccountFactory(parent_account=None)
    qs = _qs("parent_account__isnull=true")
    assert qs.count() == 2  # parent itself + the orphan


def test_filter_employees_gt_lt(active_tenant):  # type: ignore[no-untyped-def]
    AccountFactory(employees=10)
    AccountFactory(employees=500)
    AccountFactory(employees=5000)
    qs = _qs("employees__gt=100&employees__lt=1000")
    assert qs.count() == 1
    assert qs.first().employees == 500


def test_filter_annual_revenue_gt_lt(active_tenant):  # type: ignore[no-untyped-def]
    AccountFactory(annual_revenue=Decimal("1000.00"))
    AccountFactory(annual_revenue=Decimal("1000000.00"))
    AccountFactory(annual_revenue=Decimal("100000000.00"))
    qs = _qs("annual_revenue__gt=10000&annual_revenue__lt=10000000")
    assert qs.count() == 1
    assert qs.first().annual_revenue == Decimal("1000000.00")


def test_filter_tags_contains(active_tenant):  # type: ignore[no-untyped-def]
    AccountFactory(tags=["enterprise", "vip"])
    AccountFactory(tags=["smb"])
    AccountFactory(tags=["enterprise", "partner"])
    qs = _qs("tags__contains=enterprise")
    assert qs.count() == 2


def test_filter_created_at_range(active_tenant):  # type: ignore[no-untyped-def]
    now = timezone.now()
    old = AccountFactory()
    Account.objects.filter(pk=old.pk).update(created_at=now - timedelta(days=10))
    new = AccountFactory()
    Account.objects.filter(pk=new.pk).update(created_at=now - timedelta(days=1))
    since = (now - timedelta(days=5)).isoformat()
    qs = _qs(f"created_at__gte={since}")
    assert qs.count() == 1
    assert qs.first().pk == new.pk


def test_filter_last_activity_isnull(active_tenant):  # type: ignore[no-untyped-def]
    AccountFactory(last_activity=timezone.now())
    AccountFactory(last_activity=None)
    qs = _qs("last_activity__isnull=true")
    assert qs.count() == 1
    assert qs.first().last_activity is None


def test_filter_custom_field(active_tenant):  # type: ignore[no-untyped-def]
    from custom_fields.factories import CustomFieldFactory, CustomFieldValueFactory

    field = CustomFieldFactory(api_name="segment", module="account", field_type="text")
    a1 = AccountFactory(name="GoldAcct")
    a2 = AccountFactory(name="SilverAcct")
    CustomFieldValueFactory(field=field, module="account", record_id=str(a1.pk), value="gold")
    CustomFieldValueFactory(field=field, module="account", record_id=str(a2.pk), value="silver")
    qs = _qs("custom_field=segment:gold")
    assert qs.count() == 1
    assert qs.first().name == "GoldAcct"


def test_filter_custom_field_without_colon_is_noop(active_tenant):  # type: ignore[no-untyped-def]
    AccountFactory.create_batch(2)
    qs = _qs("custom_field=no_colon_here")
    assert qs.count() == 2


def test_filter_is_tenant_scoped(active_tenant):  # type: ignore[no-untyped-def]
    other = OrganizationFactory(subdomain="other", slug="other")
    with tenant_context(other):
        AccountFactory(name="OtherTenant")
    set_current_tenant(active_tenant)
    AccountFactory(name="Mine")
    qs = _qs("")
    names = [a.name for a in qs]
    assert names == ["Mine"]
