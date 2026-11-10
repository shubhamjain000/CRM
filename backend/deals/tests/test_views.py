"""ViewSet / API tests for the deals app."""

from __future__ import annotations

from decimal import Decimal

import pytest

from contacts.factories import ContactFactory
from deals.factories import DealFactory, PipelineFactory, StageFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def pipeline_and_stages(active_tenant):  # type: ignore[no-untyped-def]
    pipeline = PipelineFactory()
    stages = StageFactory.create_batch(3, pipeline=pipeline)
    return pipeline, stages


def test_list_deals(request_factory, active_tenant, pipeline_and_stages):  # type: ignore[no-untyped-def]
    pipeline, stages = pipeline_and_stages
    DealFactory.create_batch(3, pipeline=pipeline, stage=stages[0])
    response = request_factory("GET", "/api/v1/deals/")
    assert response.status_code == 200
    assert response.json()["count"] == 3


def test_create_deal(request_factory, active_tenant, user, pipeline_and_stages):  # type: ignore[no-untyped-def]
    pipeline, stages = pipeline_and_stages
    payload = {
        "name": "New Deal",
        "amount": "1234.56",
        "stage": stages[0].pk,
        "pipeline": pipeline.pk,
        "probability": 30,
        "type": "new_business",
    }
    response = request_factory("POST", "/api/v1/deals/", payload, format="json")
    assert response.status_code == 201, response.content
    assert response.json()["owner"] == user.pk


def test_update_deal(request_factory, active_tenant, pipeline_and_stages):  # type: ignore[no-untyped-def]
    pipeline, stages = pipeline_and_stages
    deal = DealFactory(pipeline=pipeline, stage=stages[0])
    response = request_factory(
        "PATCH",
        f"/api/v1/deals/{deal.pk}/",
        {"amount": "9999.99"},
        format="json",
    )
    assert response.status_code == 200
    deal.refresh_from_db()
    assert deal.amount == Decimal("9999.99")


def test_destroy_deal(request_factory, active_tenant, pipeline_and_stages):  # type: ignore[no-untyped-def]
    from deals.models import Deal

    pipeline, stages = pipeline_and_stages
    deal = DealFactory(pipeline=pipeline, stage=stages[0])
    response = request_factory("DELETE", f"/api/v1/deals/{deal.pk}/")
    assert response.status_code == 204
    deal.refresh_from_db()
    assert deal.deleted_at is not None
    assert Deal.objects.filter(pk=deal.pk).count() == 0


def test_restore_deal(request_factory, active_tenant, pipeline_and_stages):  # type: ignore[no-untyped-def]
    from deals.models import Deal

    pipeline, stages = pipeline_and_stages
    deal = DealFactory(pipeline=pipeline, stage=stages[0])
    deal.soft_delete()
    response = request_factory("POST", f"/api/v1/deals/{deal.pk}/restore/")
    assert response.status_code == 200
    assert Deal.objects.filter(pk=deal.pk).count() == 1


def test_change_stage_action(request_factory, active_tenant, pipeline_and_stages):  # type: ignore[no-untyped-def]
    pipeline, stages = pipeline_and_stages
    deal = DealFactory(pipeline=pipeline, stage=stages[0])
    response = request_factory(
        "POST",
        f"/api/v1/deals/{deal.pk}/change-stage/",
        {"stage_id": stages[1].pk},
        format="json",
    )
    assert response.status_code == 200, response.content
    deal.refresh_from_db()
    assert deal.stage_id == stages[1].pk


def test_change_stage_to_won_sets_probability(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    pipeline = PipelineFactory()
    open_stage = StageFactory(pipeline=pipeline, probability=25.0)
    won_stage = StageFactory(pipeline=pipeline, is_won_stage=True, probability=100.0)
    deal = DealFactory(pipeline=pipeline, stage=open_stage, probability=25.0)
    response = request_factory(
        "POST",
        f"/api/v1/deals/{deal.pk}/change-stage/",
        {"stage_id": won_stage.pk},
        format="json",
    )
    assert response.status_code == 200
    deal.refresh_from_db()
    assert deal.is_won is True
    assert deal.probability == 100.0


def test_add_and_remove_contact(request_factory, active_tenant, pipeline_and_stages):  # type: ignore[no-untyped-def]
    pipeline, stages = pipeline_and_stages
    deal = DealFactory(pipeline=pipeline, stage=stages[0])
    contact = ContactFactory()
    add_resp = request_factory(
        "POST",
        f"/api/v1/deals/{deal.pk}/add-contact/",
        {"contact_id": contact.pk, "role": "decision_maker"},
        format="json",
    )
    assert add_resp.status_code == 200, add_resp.content
    assert add_resp.json()["contact"] == contact.pk
    rm_resp = request_factory(
        "POST",
        f"/api/v1/deals/{deal.pk}/remove-contact/",
        {"contact_id": contact.pk},
        format="json",
    )
    assert rm_resp.status_code == 200
    assert rm_resp.json()["removed"] == 1


def test_merge_deals(request_factory, active_tenant, pipeline_and_stages):  # type: ignore[no-untyped-def]
    from deals.models import Deal

    pipeline, stages = pipeline_and_stages
    source = DealFactory(
        pipeline=pipeline, stage=stages[0], amount=Decimal("500.00"), probability=80.0
    )
    target = DealFactory(
        pipeline=pipeline, stage=stages[0], amount=Decimal("0"), probability=20.0
    )
    response = request_factory(
        "POST",
        "/api/v1/deals/merge/",
        {"source_id": source.pk, "target_id": target.pk},
        format="json",
    )
    assert response.status_code == 200, response.content
    target.refresh_from_db()
    # Amount copied from source since target was empty.
    assert target.amount == Decimal("500.00")
    # Probability: source's higher wins.
    assert target.probability == 80.0
    source.refresh_from_db()
    assert source.deleted_at is not None
    assert Deal.objects.filter(pk=source.pk).count() == 0


def test_filter_is_won(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    pipeline = PipelineFactory()
    won = StageFactory(pipeline=pipeline, is_won_stage=True, probability=100.0)
    open_stage = StageFactory(pipeline=pipeline, probability=25.0)
    DealFactory.create_batch(2, pipeline=pipeline, stage=won)
    DealFactory.create_batch(3, pipeline=pipeline, stage=open_stage)
    response = request_factory("GET", "/api/v1/deals/?is_won=true")
    assert response.status_code == 200
    assert response.json()["count"] == 2


def test_filter_amount_range(request_factory, active_tenant, pipeline_and_stages):  # type: ignore[no-untyped-def]
    pipeline, stages = pipeline_and_stages
    DealFactory(pipeline=pipeline, stage=stages[0], amount=Decimal("100.00"))
    DealFactory(pipeline=pipeline, stage=stages[0], amount=Decimal("5000.00"))
    DealFactory(pipeline=pipeline, stage=stages[0], amount=Decimal("10000.00"))
    response = request_factory("GET", "/api/v1/deals/?amount__gt=200&amount__lt=8000")
    assert response.status_code == 200
    assert response.json()["count"] == 1


def test_sort_by_amount(request_factory, active_tenant, pipeline_and_stages):  # type: ignore[no-untyped-def]
    pipeline, stages = pipeline_and_stages
    DealFactory(pipeline=pipeline, stage=stages[0], amount=Decimal("300.00"))
    DealFactory(pipeline=pipeline, stage=stages[0], amount=Decimal("100.00"))
    response = request_factory("GET", "/api/v1/deals/?sort=amount")
    amounts = [r["amount"] for r in response.json()["results"]]
    assert amounts == ["100.00", "300.00"]
