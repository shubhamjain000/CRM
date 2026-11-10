"""Model-level tests for the deals app."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest

from deals.factories import DealFactory, PipelineFactory, StageFactory
from deals.models import Deal, DealContact

pytestmark = pytest.mark.django_db


def test_pipeline_factory_creates_row(active_tenant):  # type: ignore[no-untyped-def]
    pipeline = PipelineFactory()
    assert pipeline.pk is not None
    assert pipeline.tenant_id == active_tenant.pk


def test_stage_factory_creates_row(active_tenant):  # type: ignore[no-untyped-def]
    stage = StageFactory()
    assert stage.pk is not None
    assert 0 <= stage.probability <= 100


def test_stage_clean_rejects_won_and_lost(active_tenant):  # type: ignore[no-untyped-def]
    from django.core.exceptions import ValidationError

    stage = StageFactory.build(is_won_stage=True, is_lost_stage=True)
    stage.tenant = active_tenant
    with pytest.raises(ValidationError):
        stage.clean()


def test_stage_clean_rejects_bad_won_probability(active_tenant):  # type: ignore[no-untyped-def]
    from django.core.exceptions import ValidationError

    stage = StageFactory.build(is_won_stage=True, probability=50.0)
    stage.tenant = active_tenant
    with pytest.raises(ValidationError):
        stage.clean()


def test_stage_check_constraint_rejects_bad_probability(active_tenant):  # type: ignore[no-untyped-def]
    from django.db import IntegrityError

    stage = StageFactory.build(probability=150.0)
    stage.tenant = active_tenant
    with pytest.raises(IntegrityError):
        stage.save()


def test_deal_expected_revenue(active_tenant):  # type: ignore[no-untyped-def]
    deal = DealFactory(amount=Decimal("1000.00"), probability=25.0)
    assert deal.expected_revenue == Decimal("250.00")


def test_deal_age(active_tenant):  # type: ignore[no-untyped-def]
    deal = DealFactory()
    # ``created_at`` is just now, so age is 0.
    assert deal.age == 0
    # Force a backdated create.
    Deal.objects.filter(pk=deal.pk).update(
        created_at=deal.created_at - timedelta(days=5)
    )
    deal.refresh_from_db()
    assert deal.age == 5


def test_deal_is_won_is_lost(active_tenant):  # type: ignore[no-untyped-def]
    won = StageFactory(is_won_stage=True, probability=100.0)
    lost = StageFactory(is_lost_stage=True, probability=0.0, pipeline=won.pipeline)
    open_stage = StageFactory(pipeline=won.pipeline)

    won_deal = DealFactory(stage=won, pipeline=won.pipeline)
    lost_deal = DealFactory(stage=lost, pipeline=won.pipeline)
    open_deal = DealFactory(stage=open_stage, pipeline=won.pipeline)

    assert won_deal.is_won and not won_deal.is_lost and not won_deal.is_open
    assert lost_deal.is_lost and not lost_deal.is_won and not lost_deal.is_open
    assert open_deal.is_open and not open_deal.is_won and not open_deal.is_lost


def test_deal_soft_delete(active_tenant):  # type: ignore[no-untyped-def]
    deal = DealFactory()
    deal.soft_delete()
    assert Deal.objects.filter(pk=deal.pk).count() == 0
    assert Deal.all_objects.filter(pk=deal.pk).count() == 1


def test_dealcontact_unique(active_tenant):  # type: ignore[no-untyped-def]
    from django.db import IntegrityError

    deal = DealFactory()
    from contacts.factories import ContactFactory

    contact = ContactFactory()
    DealContact.objects.create(deal=deal, contact=contact, role="decision_maker")
    with pytest.raises(IntegrityError):
        DealContact.objects.create(deal=deal, contact=contact, role="influencer")


def test_deal_type_check_constraint(active_tenant):  # type: ignore[no-untyped-def]
    from django.db import IntegrityError

    deal = DealFactory.build(type="bogus")
    deal.tenant = active_tenant
    deal.stage = StageFactory()
    deal.pipeline = deal.stage.pipeline
    with pytest.raises(IntegrityError):
        deal.save()
