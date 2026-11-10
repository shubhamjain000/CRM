"""Serializer tests for the deals app."""

from __future__ import annotations

from decimal import Decimal

import pytest

from accounts.factories import AccountFactory
from contacts.factories import ContactFactory
from deals.factories import PipelineFactory, StageFactory
from deals.serializers import DealSerializer, PipelineSerializer, StageSerializer

pytestmark = pytest.mark.django_db


def test_deal_serializer_round_trip(active_tenant, user):  # type: ignore[no-untyped-def]
    pipeline = PipelineFactory()
    stage = StageFactory(pipeline=pipeline, probability=25.0)
    account = AccountFactory()
    contact = ContactFactory()
    payload = {
        "name": "Big Deal",
        "amount": "50000.00",
        "currency": "USD",
        "stage": stage.pk,
        "pipeline": pipeline.pk,
        "close_date": "2099-01-01",
        "account": account.pk,
        "primary_contact": contact.pk,
        "contact_ids": [contact.pk],
        "type": "new_business",
    }
    serializer = DealSerializer(data=payload, context={"request": None})
    assert serializer.is_valid(), serializer.errors
    instance = serializer.save(tenant=active_tenant, owner=user)
    assert instance.name == "Big Deal"
    assert instance.amount == Decimal("50000.00")
    assert instance.contact_links.count() == 1


def test_deal_serializer_rejects_bad_probability(active_tenant):  # type: ignore[no-untyped-def]
    pipeline = PipelineFactory()
    stage = StageFactory(pipeline=pipeline)
    serializer = DealSerializer(
        data={"name": "T", "amount": "1.00", "stage": stage.pk, "pipeline": pipeline.pk, "probability": 150},
        context={"request": None},
    )
    assert not serializer.is_valid()
    assert "probability" in serializer.errors


def test_deal_serializer_rejects_stage_pipeline_mismatch(active_tenant):  # type: ignore[no-untyped-def]
    p1 = PipelineFactory()
    p2 = PipelineFactory()
    s1 = StageFactory(pipeline=p1)
    serializer = DealSerializer(
        data={"name": "T", "amount": "1.00", "stage": s1.pk, "pipeline": p2.pk},
        context={"request": None},
    )
    assert not serializer.is_valid()
    assert "stage" in serializer.errors


def test_deal_serializer_defaults_probability_from_stage(active_tenant, user):  # type: ignore[no-untyped-def]
    pipeline = PipelineFactory()
    stage = StageFactory(pipeline=pipeline, probability=40.0)
    payload = {
        "name": "DefaultProb",
        "amount": "1.00",
        "stage": stage.pk,
        "pipeline": pipeline.pk,
    }
    serializer = DealSerializer(data=payload, context={"request": None})
    assert serializer.is_valid(), serializer.errors
    instance = serializer.save(tenant=active_tenant, owner=user)
    assert instance.probability == 40.0


def test_deal_serializer_expected_revenue_in_response(active_tenant):  # type: ignore[no-untyped-def]
    pipeline = PipelineFactory()
    stage = StageFactory(pipeline=pipeline, probability=50.0)
    from deals.factories import DealFactory

    deal = DealFactory(amount=Decimal("200.00"), probability=50.0, stage=stage, pipeline=pipeline)
    data = DealSerializer(deal, context={"request": None}).data
    assert "expected_revenue" in data
    assert "is_won" in data
    assert "is_lost" in data
    assert "is_open" in data
    assert data["age"] == 0


def test_pipeline_serializer_includes_stages(active_tenant):  # type: ignore[no-untyped-def]
    pipeline = PipelineFactory()
    StageFactory.create_batch(3, pipeline=pipeline)
    data = PipelineSerializer(pipeline, context={"request": None}).data
    assert len(data["stages"]) == 3


def test_stage_serializer_round_trip(active_tenant):  # type: ignore[no-untyped-def]
    pipeline = PipelineFactory()
    serializer = StageSerializer(
        data={"pipeline": pipeline.pk, "name": "Won", "probability": 100.0, "is_won_stage": True},
        context={"request": None},
    )
    assert serializer.is_valid(), serializer.errors
    stage = serializer.save(tenant=active_tenant)
    assert stage.is_won_stage is True
    # ``Stage.save()`` auto-derives ``is_closed`` from ``is_won_stage`` /
    # ``is_lost_stage`` so the column is consistent regardless of write path.
    assert stage.is_closed is True
    stage.refresh_from_db()
    assert stage.is_closed is True


def test_deal_serializer_competitors_must_be_list(active_tenant):  # type: ignore[no-untyped-def]
    pipeline = PipelineFactory()
    stage = StageFactory(pipeline=pipeline)
    serializer = DealSerializer(
        data={"name": "T", "amount": "1.00", "stage": stage.pk, "pipeline": pipeline.pk, "competitors": "not-a-list"},
        context={"request": None},
    )
    assert not serializer.is_valid()
    assert "competitors" in serializer.errors
