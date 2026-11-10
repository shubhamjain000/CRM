"""Filter tests for the deals app.

Exercises :class:`deals.filters.DealFilter` directly (no HTTP layer) to cover
the django-filter wiring: exact / icontains / gt / lt / in / range / isnull
lookups, the ``is_won`` / ``is_lost`` / ``is_open`` derived filters, and the
custom-field filter method.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest

from django.utils import timezone

from accounts.factories import AccountFactory
from api.factories import OrganizationFactory, UserFactory
from api.managers import set_current_tenant, tenant_context
from deals.factories import DealFactory, PipelineFactory, StageFactory
from deals.filters import DealFilter
from deals.models import Deal

pytestmark = pytest.mark.django_db


def _qs(query: str) -> "Deal":  # type: ignore[type-arg]
    """Build a DealFilter from a query string and return its queryset."""
    params: dict[str, str] = {}
    for pair in query.lstrip("?").split("&"):
        if not pair:
            continue
        key, _, value = pair.partition("=")
        params[key] = value
    return DealFilter(params, queryset=Deal.objects.all()).qs


@pytest.fixture
def pipeline_with_stages(active_tenant):  # type: ignore[no-untyped-def]
    pipeline = PipelineFactory()
    open_stages = StageFactory.create_batch(3, pipeline=pipeline)
    won = StageFactory(pipeline=pipeline, is_won_stage=True, probability=100.0, order=10)
    lost = StageFactory(pipeline=pipeline, is_lost_stage=True, probability=0.0, order=11)
    return pipeline, open_stages, won, lost


def test_filter_by_name_icontains(pipeline_with_stages):  # type: ignore[no-untyped-def]
    pipeline, stages, _, _ = pipeline_with_stages
    DealFactory(pipeline=pipeline, stage=stages[0], name="Acme Deal")
    DealFactory(pipeline=pipeline, stage=stages[0], name="Globex Deal")
    qs = _qs("name=acme")
    assert qs.count() == 1
    assert qs.first().name == "Acme Deal"


def test_filter_by_stage(pipeline_with_stages):  # type: ignore[no-untyped-def]
    pipeline, stages, _, _ = pipeline_with_stages
    DealFactory(pipeline=pipeline, stage=stages[0])
    DealFactory(pipeline=pipeline, stage=stages[1])
    qs = _qs(f"stage={stages[0].pk}")
    assert qs.count() == 1
    assert qs.first().stage_id == stages[0].pk


def test_filter_by_stage_in(pipeline_with_stages):  # type: ignore[no-untyped-def]
    pipeline, stages, _, _ = pipeline_with_stages
    DealFactory(pipeline=pipeline, stage=stages[0])
    DealFactory(pipeline=pipeline, stage=stages[1])
    DealFactory(pipeline=pipeline, stage=stages[2])
    qs = DealFilter(
        {"stage_in": [str(stages[0].pk), str(stages[1].pk)]},
        queryset=Deal.objects.all(),
    ).qs
    assert qs.count() == 2


def test_filter_by_pipeline(pipeline_with_stages):  # type: ignore[no-untyped-def]
    pipeline, stages, _, _ = pipeline_with_stages
    other_pipeline = PipelineFactory()
    other_stage = StageFactory(pipeline=other_pipeline)
    DealFactory.create_batch(2, pipeline=pipeline, stage=stages[0])
    DealFactory(pipeline=other_pipeline, stage=other_stage)
    qs = _qs(f"pipeline={pipeline.pk}")
    assert qs.count() == 2


def test_filter_by_owner(pipeline_with_stages, user):  # type: ignore[no-untyped-def]
    pipeline, stages, _, _ = pipeline_with_stages
    other = UserFactory()
    DealFactory(pipeline=pipeline, stage=stages[0], owner=user)
    DealFactory(pipeline=pipeline, stage=stages[0], owner=other)
    qs = _qs(f"owner={user.pk}")
    assert qs.count() == 1


def test_filter_by_owner_in(pipeline_with_stages, user):  # type: ignore[no-untyped-def]
    pipeline, stages, _, _ = pipeline_with_stages
    other = UserFactory()
    DealFactory(pipeline=pipeline, stage=stages[0], owner=user)
    DealFactory(pipeline=pipeline, stage=stages[0], owner=other)
    DealFactory(pipeline=pipeline, stage=stages[0], owner=other)
    qs = DealFilter(
        {"owner_in": [str(user.pk), str(other.pk)]},
        queryset=Deal.objects.all(),
    ).qs
    assert qs.count() == 3


def test_filter_by_account(pipeline_with_stages):  # type: ignore[no-untyped-def]
    pipeline, stages, _, _ = pipeline_with_stages
    acct = AccountFactory()
    DealFactory(pipeline=pipeline, stage=stages[0], account=acct)
    DealFactory(pipeline=pipeline, stage=stages[0], account=None)
    qs = _qs(f"account={acct.pk}")
    assert qs.count() == 1


def test_filter_account_isnull(pipeline_with_stages):  # type: ignore[no-untyped-def]
    pipeline, stages, _, _ = pipeline_with_stages
    acct = AccountFactory()
    DealFactory(pipeline=pipeline, stage=stages[0], account=acct)
    DealFactory(pipeline=pipeline, stage=stages[0], account=None)
    qs = _qs("account__isnull=true")
    assert qs.count() == 1
    assert qs.first().account_id is None


def test_filter_by_type(pipeline_with_stages):  # type: ignore[no-untyped-def]
    pipeline, stages, _, _ = pipeline_with_stages
    DealFactory(pipeline=pipeline, stage=stages[0], type="new_business")
    DealFactory(pipeline=pipeline, stage=stages[0], type="renewal")
    qs = _qs("type=renewal")
    assert qs.count() == 1


def test_filter_amount_gt_lt(pipeline_with_stages):  # type: ignore[no-untyped-def]
    pipeline, stages, _, _ = pipeline_with_stages
    DealFactory(pipeline=pipeline, stage=stages[0], amount=Decimal("100.00"))
    DealFactory(pipeline=pipeline, stage=stages[0], amount=Decimal("5000.00"))
    DealFactory(pipeline=pipeline, stage=stages[0], amount=Decimal("100000.00"))
    qs = _qs("amount__gt=1000&amount__lt=10000")
    assert qs.count() == 1
    assert qs.first().amount == Decimal("5000.00")


def test_filter_probability_gt_lt(pipeline_with_stages):  # type: ignore[no-untyped-def]
    pipeline, stages, _, _ = pipeline_with_stages
    DealFactory(pipeline=pipeline, stage=stages[0], probability=10.0)
    DealFactory(pipeline=pipeline, stage=stages[0], probability=50.0)
    DealFactory(pipeline=pipeline, stage=stages[0], probability=90.0)
    qs = _qs("probability__gt=20&probability__lt=80")
    assert qs.count() == 1
    assert qs.first().probability == 50.0


def test_filter_close_date_range(pipeline_with_stages):  # type: ignore[no-untyped-def]
    pipeline, stages, _, _ = pipeline_with_stages
    DealFactory(pipeline=pipeline, stage=stages[0], close_date=date(2025, 1, 1))
    DealFactory(pipeline=pipeline, stage=stages[0], close_date=date(2025, 6, 1))
    DealFactory(pipeline=pipeline, stage=stages[0], close_date=date(2026, 1, 1))
    qs = _qs("close_date__gte=2025-03-01&close_date__lte=2025-12-31")
    assert qs.count() == 1
    assert qs.first().close_date == date(2025, 6, 1)


def test_filter_close_date_isnull(pipeline_with_stages):  # type: ignore[no-untyped-def]
    pipeline, stages, _, _ = pipeline_with_stages
    DealFactory(pipeline=pipeline, stage=stages[0], close_date=date(2025, 1, 1))
    DealFactory(pipeline=pipeline, stage=stages[0], close_date=None)
    qs = _qs("close_date__isnull=true")
    assert qs.count() == 1
    assert qs.first().close_date is None


def test_filter_is_won(pipeline_with_stages):  # type: ignore[no-untyped-def]
    pipeline, stages, won, _ = pipeline_with_stages
    DealFactory.create_batch(2, pipeline=pipeline, stage=won)
    DealFactory(pipeline=pipeline, stage=stages[0])
    qs = _qs("is_won=true")
    assert qs.count() == 2
    qs_false = _qs("is_won=false")
    assert qs_false.count() == 1


def test_filter_is_lost(pipeline_with_stages):  # type: ignore[no-untyped-def]
    pipeline, stages, _, lost = pipeline_with_stages
    DealFactory.create_batch(2, pipeline=pipeline, stage=lost)
    DealFactory(pipeline=pipeline, stage=stages[0])
    qs = _qs("is_lost=true")
    assert qs.count() == 2


def test_filter_is_open(pipeline_with_stages):  # type: ignore[no-untyped-def]
    pipeline, stages, won, lost = pipeline_with_stages
    DealFactory.create_batch(3, pipeline=pipeline, stage=stages[0])
    DealFactory(pipeline=pipeline, stage=won)
    DealFactory(pipeline=pipeline, stage=lost)
    qs = _qs("is_open=true")
    assert qs.count() == 3
    qs_false = _qs("is_open=false")
    assert qs_false.count() == 2


def test_filter_created_at_range(pipeline_with_stages):  # type: ignore[no-untyped-def]
    pipeline, stages, _, _ = pipeline_with_stages
    now = timezone.now()
    old = DealFactory(pipeline=pipeline, stage=stages[0])
    Deal.objects.filter(pk=old.pk).update(created_at=now - timedelta(days=10))
    new = DealFactory(pipeline=pipeline, stage=stages[0])
    Deal.objects.filter(pk=new.pk).update(created_at=now - timedelta(days=1))
    since = (now - timedelta(days=5)).isoformat()
    qs = _qs(f"created_at__gte={since}")
    assert qs.count() == 1
    assert qs.first().pk == new.pk


def test_filter_custom_field(pipeline_with_stages):  # type: ignore[no-untyped-def]
    from custom_fields.factories import CustomFieldFactory, CustomFieldValueFactory

    pipeline, stages, _, _ = pipeline_with_stages
    field = CustomFieldFactory(api_name="discount_code", module="deal", field_type="text")
    d1 = DealFactory(pipeline=pipeline, stage=stages[0], name="VIP Deal")
    d2 = DealFactory(pipeline=pipeline, stage=stages[0], name="Regular Deal")
    CustomFieldValueFactory(field=field, module="deal", record_id=str(d1.pk), value="VIP10")
    CustomFieldValueFactory(field=field, module="deal", record_id=str(d2.pk), value="REG5")
    qs = _qs("custom_field=discount_code:VIP10")
    assert qs.count() == 1
    assert qs.first().name == "VIP Deal"


def test_filter_custom_field_without_colon_is_noop(pipeline_with_stages):  # type: ignore[no-untyped-def]
    pipeline, stages, _, _ = pipeline_with_stages
    DealFactory.create_batch(2, pipeline=pipeline, stage=stages[0])
    qs = _qs("custom_field=no_colon_here")
    assert qs.count() == 2


def test_filter_is_tenant_scoped(pipeline_with_stages):  # type: ignore[no-untyped-def]
    pipeline, stages, _, _ = pipeline_with_stages
    other = OrganizationFactory(subdomain="other", slug="other")
    with tenant_context(other):
        other_pipeline = PipelineFactory()
        other_stage = StageFactory(pipeline=other_pipeline)
        DealFactory(pipeline=other_pipeline, stage=other_stage, name="OtherTenant")
    set_current_tenant(active_tenant)
    DealFactory(pipeline=pipeline, stage=stages[0], name="Mine")
    qs = _qs("")
    names = [d.name for d in qs]
    assert names == ["Mine"]
