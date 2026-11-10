"""Filter tests for the contacts app.

Exercises :class:`contacts.filters.ContactFilter` directly (no HTTP layer)
to cover the django-filter wiring: exact / icontains / gt / lt / in / range /
isnull lookups, the JSON ``emails`` containment filter, and the custom-field
filter method.
"""

from __future__ import annotations

from datetime import date, timedelta

from django.utils import timezone

import pytest

from accounts.factories import AccountFactory
from api.factories import OrganizationFactory, UserFactory
from api.managers import set_current_tenant, tenant_context
from contacts.factories import ContactFactory
from contacts.filters import ContactFilter
from contacts.models import Contact

pytestmark = pytest.mark.django_db


def _qs(query: str) -> "Contact":  # type: ignore[type-arg]
    """Build a ContactFilter from a query string and return its queryset."""
    params: dict[str, str] = {}
    for pair in query.lstrip("?").split("&"):
        if not pair:
            continue
        key, _, value = pair.partition("=")
        params[key] = value
    return ContactFilter(params, queryset=Contact.objects.all()).qs


def test_filter_by_first_name_icontains(active_tenant):  # type: ignore[no-untyped-def]
    ContactFactory(first_name="Ada")
    ContactFactory(first_name="Alan")
    ContactFactory(first_name="Grace")
    qs = _qs("first_name=a")
    names = sorted(c.first_name for c in qs)
    assert names == ["Ada", "Alan"]


def test_filter_by_last_name_icontains(active_tenant):  # type: ignore[no-untyped-def]
    ContactFactory(last_name="Lovelace")
    ContactFactory(last_name="Turing")
    qs = _qs("last_name=love")
    assert qs.count() == 1
    assert qs.first().last_name == "Lovelace"


def test_filter_by_email_json_contains(active_tenant):  # type: ignore[no-untyped-def]
    ContactFactory(emails=[{"email": "ada@example.com", "type": "work"}])
    ContactFactory(emails=[{"email": "alan@example.com", "type": "work"}])
    qs = _qs("email=alan@example.com")
    assert qs.count() == 1


def test_filter_by_account(active_tenant):  # type: ignore[no-untyped-def]
    acct = AccountFactory()
    ContactFactory.create_batch(2, account=acct)
    ContactFactory.create_batch(1, account=None)
    qs = _qs(f"account={acct.pk}")
    assert qs.count() == 2


def test_filter_account_isnull(active_tenant):  # type: ignore[no-untyped-def]
    acct = AccountFactory()
    ContactFactory(account=acct)
    ContactFactory(account=None)
    qs = _qs("account__isnull=true")
    assert qs.count() == 1
    assert qs.first().account_id is None


def test_filter_by_owner_in(active_tenant, user):  # type: ignore[no-untyped-def]
    other = UserFactory()
    ContactFactory(owner=user)
    ContactFactory(owner=user)
    ContactFactory(owner=other)
    qs = ContactFilter(
        {"owner_in": [str(user.pk), str(other.pk)]},
        queryset=Contact.objects.all(),
    ).qs
    assert qs.count() == 3


def test_filter_by_lead_source(active_tenant):  # type: ignore[no-untyped-def]
    ContactFactory.create_batch(2, lead_source="web")
    ContactFactory.create_batch(1, lead_source="referral")
    qs = _qs("lead_source=web")
    assert qs.count() == 2


def test_filter_do_not_call(active_tenant):  # type: ignore[no-untyped-def]
    ContactFactory(do_not_call=True)
    ContactFactory(do_not_call=False)
    qs = _qs("do_not_call=true")
    assert qs.count() == 1
    assert qs.first().do_not_call is True


def test_filter_email_opt_out(active_tenant):  # type: ignore[no-untyped-def]
    ContactFactory(email_opt_out=True)
    ContactFactory(email_opt_out=False)
    qs = _qs("email_opt_out=true")
    assert qs.count() == 1


def test_filter_birthday_range(active_tenant):  # type: ignore[no-untyped-def]
    ContactFactory(birthday=date(1990, 1, 1))
    ContactFactory(birthday=date(1995, 6, 15))
    ContactFactory(birthday=date(2000, 12, 31))
    qs = _qs("birthday__gte=1994-01-01&birthday__lte=1999-12-31")
    assert qs.count() == 1
    assert qs.first().birthday == date(1995, 6, 15)


def test_filter_created_at_range(active_tenant):  # type: ignore[no-untyped-def]
    now = timezone.now()
    old = ContactFactory()
    Contact.objects.filter(pk=old.pk).update(created_at=now - timedelta(days=10))
    new = ContactFactory()
    Contact.objects.filter(pk=new.pk).update(created_at=now - timedelta(days=1))
    since = (now - timedelta(days=5)).isoformat()
    qs = _qs(f"created_at__gte={since}")
    assert qs.count() == 1
    assert qs.first().pk == new.pk


def test_filter_last_activity_isnull(active_tenant):  # type: ignore[no-untyped-def]
    ContactFactory(last_activity=timezone.now())
    ContactFactory(last_activity=None)
    qs = _qs("last_activity__isnull=true")
    assert qs.count() == 1
    assert qs.first().last_activity is None


def test_filter_custom_field(active_tenant):  # type: ignore[no-untyped-def]
    from custom_fields.factories import CustomFieldFactory, CustomFieldValueFactory

    field = CustomFieldFactory(api_name="preferred_channel", module="contact", field_type="text")
    c1 = ContactFactory(first_name="EmailContact")
    c2 = ContactFactory(first_name="PhoneContact")
    CustomFieldValueFactory(field=field, module="contact", record_id=str(c1.pk), value="email")
    CustomFieldValueFactory(field=field, module="contact", record_id=str(c2.pk), value="phone")
    qs = _qs("custom_field=preferred_channel:email")
    assert qs.count() == 1
    assert qs.first().first_name == "EmailContact"


def test_filter_custom_field_without_colon_is_noop(active_tenant):  # type: ignore[no-untyped-def]
    ContactFactory.create_batch(2)
    qs = _qs("custom_field=no_colon_here")
    assert qs.count() == 2


def test_filter_is_tenant_scoped(active_tenant):  # type: ignore[no-untyped-def]
    other = OrganizationFactory(subdomain="other", slug="other")
    with tenant_context(other):
        ContactFactory(first_name="OtherTenant")
    set_current_tenant(active_tenant)
    ContactFactory(first_name="Mine")
    qs = _qs("")
    names = [c.first_name for c in qs]
    assert names == ["Mine"]
