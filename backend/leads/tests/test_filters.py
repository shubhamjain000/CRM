"""Filter tests for the leads app.

Exercises :class:`leads.filters.LeadFilter` directly (no HTTP layer) to cover
the django-filter wiring: exact / icontains / gt / lt / in / range / isnull
lookups, the JSON ``emails`` containment filter, and the custom-field filter
method.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from api.factories import OrganizationFactory
from api.managers import set_current_tenant, tenant_context
from leads.factories import LeadFactory
from leads.filters import LeadFilter
from leads.models import Lead

pytestmark = pytest.mark.django_db


def _qs(query: str) -> "Lead":  # type: ignore[type-arg]
    """Build a LeadFilter from a query string and return its queryset."""
    # django_filters normalises a dict from a QueryDict via MultiValueDict;
    # for tests we pass a plain dict — one value per key is enough.
    params: dict[str, str] = {}
    for pair in query.lstrip("?").split("&"):
        if not pair:
            continue
        key, _, value = pair.partition("=")
        params[key] = value
    return LeadFilter(params, queryset=Lead.objects.all()).qs


def test_filter_by_lead_status_exact(active_tenant):  # type: ignore[no-untyped-def]
    LeadFactory.create_batch(2, lead_status="new")
    LeadFactory.create_batch(1, lead_status="contacted")
    qs = _qs("lead_status=contacted")
    assert qs.count() == 1
    assert all(l.lead_status == "contacted" for l in qs)


def test_filter_by_lead_status_in(active_tenant):  # type: ignore[no-untyped-def]
    LeadFactory(lead_status="new")
    LeadFactory(lead_status="contacted")
    LeadFactory(lead_status="qualified")
    # BaseInFilter accepts comma-separated values.
    qs = LeadFilter(
        {"lead_status_in": ["new", "contacted"]},
        queryset=Lead.objects.all(),
    ).qs
    assert qs.count() == 2


def test_filter_by_rating(active_tenant):  # type: ignore[no-untyped-def]
    LeadFactory.create_batch(2, rating="hot")
    LeadFactory.create_batch(1, rating="cold")
    qs = _qs("rating=hot")
    assert qs.count() == 2


def test_filter_by_first_name_icontains(active_tenant):  # type: ignore[no-untyped-def]
    LeadFactory(first_name="Ada")
    LeadFactory(first_name="Alan")
    LeadFactory(first_name="Grace")
    qs = _qs("first_name=a")
    # "Ada" and "Alan" both contain "a"; "Grace" doesn't.
    names = sorted(l.first_name for l in qs)
    assert names == ["Ada", "Alan"]


def test_filter_by_company_icontains(active_tenant):  # type: ignore[no-untyped-def]
    LeadFactory(company="Acme Corp")
    LeadFactory(company="Initech LLC")
    qs = _qs("company=acme")
    assert qs.count() == 1
    assert qs.first().company == "Acme Corp"


def test_filter_by_email_json_contains(active_tenant):  # type: ignore[no-untyped-def]
    LeadFactory(emails=[{"email": "ada@example.com", "type": "work"}])
    LeadFactory(emails=[{"email": "alan@example.com", "type": "work"}])
    qs = _qs("email=ada@example.com")
    assert qs.count() == 1


def test_filter_by_owner(active_tenant, user):  # type: ignore[no-untyped-def]
    LeadFactory(owner=user)
    from api.factories import UserFactory

    other = UserFactory()
    LeadFactory(owner=other)
    qs = _qs(f"owner={user.pk}")
    assert qs.count() == 1
    assert qs.first().owner_id == user.pk


def test_filter_assigned_to_isnull(active_tenant, user):  # type: ignore[no-untyped-def]
    LeadFactory(assigned_to=user)
    LeadFactory(assigned_to=None)
    qs = _qs("assigned_to__isnull=true")
    assert qs.count() == 1
    assert qs.first().assigned_to_id is None


def test_filter_score_gt_lt(active_tenant):  # type: ignore[no-untyped-def]
    LeadFactory(score=10.0)
    LeadFactory(score=50.0)
    LeadFactory(score=90.0)
    qs = _qs("score__gt=20&score__lt=80")
    assert qs.count() == 1
    assert qs.first().score == 50.0


def test_filter_annual_revenue_gt_lt(active_tenant):  # type: ignore[no-untyped-def]
    from decimal import Decimal

    LeadFactory(annual_revenue=Decimal("1000.00"))
    LeadFactory(annual_revenue=Decimal("50000.00"))
    LeadFactory(annual_revenue=Decimal("1000000.00"))
    qs = _qs(
        "annual_revenue__gt=10000&annual_revenue__lt=100000",
    )
    assert qs.count() == 1
    assert qs.first().annual_revenue == Decimal("50000.00")


def test_filter_created_at_range(active_tenant):  # type: ignore[no-untyped-def]
    from django.utils import timezone

    now = timezone.now()
    old = LeadFactory()
    Lead.objects.filter(pk=old.pk).update(created_at=now - timedelta(days=10))
    new = LeadFactory()
    Lead.objects.filter(pk=new.pk).update(created_at=now - timedelta(days=1))
    # Only leads created in the last 5 days.
    since = (now - timedelta(days=5)).isoformat()
    qs = _qs(f"created_at__gte={since}")
    assert qs.count() == 1
    assert qs.first().pk == new.pk


def test_filter_is_converted(active_tenant):  # type: ignore[no-untyped-def]
    LeadFactory(is_converted=False)
    LeadFactory(is_converted=True)
    qs = _qs("is_converted=true")
    assert qs.count() == 1
    assert qs.first().is_converted is True


def test_filter_custom_field(active_tenant):  # type: ignore[no-untyped-def]
    from custom_fields.factories import CustomFieldFactory, CustomFieldValueFactory

    field = CustomFieldFactory(api_name="tier", module="lead", field_type="text")
    l1 = LeadFactory(first_name="GoldLead")
    l2 = LeadFactory(first_name="SilverLead")
    CustomFieldValueFactory(field=field, module="lead", record_id=str(l1.pk), value="gold")
    CustomFieldValueFactory(field=field, module="lead", record_id=str(l2.pk), value="silver")
    qs = _qs("custom_field=tier:gold")
    assert qs.count() == 1
    assert qs.first().first_name == "GoldLead"


def test_filter_custom_field_without_colon_is_noop(active_tenant):  # type: ignore[no-untyped-def]
    LeadFactory.create_batch(2)
    qs = _qs("custom_field=no_colon_here")
    # Without ":" the filter returns the queryset unmodified.
    assert qs.count() == 2


def test_filter_is_tenant_scoped(active_tenant):  # type: ignore[no-untyped-def]
    """Filter querysets are already tenant-scoped by the manager — rows from
    other tenants must never leak through."""
    other = OrganizationFactory(subdomain="other", slug="other")
    with tenant_context(other):
        LeadFactory(first_name="OtherTenant")
    set_current_tenant(active_tenant)
    LeadFactory(first_name="Mine")
    qs = _qs("")
    names = [l.first_name for l in qs]
    assert names == ["Mine"]
