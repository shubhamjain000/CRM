"""ViewSet / API tests for the leads app — includes the convert-lead flow."""

from __future__ import annotations

from decimal import Decimal

import pytest

from deals.factories import PipelineFactory, StageFactory
from leads.factories import LeadFactory
from leads.models import Lead

pytestmark = pytest.mark.django_db


def _seed_pipeline(active_tenant):  # type: ignore[no-untyped-def]
    pipeline = PipelineFactory(is_default=True)
    StageFactory.create_batch(4, pipeline=pipeline)
    won = StageFactory(pipeline=pipeline, is_won_stage=True, probability=100.0, order=10)
    lost = StageFactory(pipeline=pipeline, is_lost_stage=True, probability=0.0, order=11)
    return pipeline


def test_list_leads(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    LeadFactory.create_batch(3)
    response = request_factory("GET", "/api/v1/leads/")
    assert response.status_code == 200
    assert response.json()["count"] == 3


def test_create_lead(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    payload = {
        "first_name": "Ada",
        "last_name": "Lovelace",
        "company": "Analytical",
        "emails": [{"email": "ada@example.com", "type": "work"}],
        "rating": "hot",
    }
    response = request_factory("POST", "/api/v1/leads/", payload, format="json")
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["owner"] == user.pk
    assert body["created_by"] == user.pk


def test_update_lead(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    lead = LeadFactory()
    response = request_factory(
        "PATCH",
        f"/api/v1/leads/{lead.pk}/",
        {"lead_status": "contacted"},
        format="json",
    )
    assert response.status_code == 200
    lead.refresh_from_db()
    assert lead.lead_status == "contacted"


def test_destroy_lead_soft_deletes(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    lead = LeadFactory()
    response = request_factory("DELETE", f"/api/v1/leads/{lead.pk}/")
    assert response.status_code == 204
    lead.refresh_from_db()
    assert lead.deleted_at is not None
    assert Lead.objects.filter(pk=lead.pk).count() == 0


def test_restore_lead(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    lead = LeadFactory()
    lead.soft_delete()
    response = request_factory("POST", f"/api/v1/leads/{lead.pk}/restore/")
    assert response.status_code == 200
    assert Lead.objects.filter(pk=lead.pk).count() == 1


def test_mass_delete_leads(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    leads = LeadFactory.create_batch(3)
    ids = [l.pk for l in leads]
    response = request_factory("POST", "/api/v1/leads/mass-delete/", {"ids": ids}, format="json")
    assert response.status_code == 200
    assert response.json()["deleted"] == 3


def test_mass_update_leads(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    leads = LeadFactory.create_batch(2, lead_status="new")
    ids = [l.pk for l in leads]
    response = request_factory(
        "POST",
        "/api/v1/leads/mass-update/",
        {"ids": ids, "fields": {"lead_status": "qualified"}},
        format="json",
    )
    assert response.status_code == 200
    assert response.json()["updated"] == 2
    for l in leads:
        l.refresh_from_db()
        assert l.lead_status == "qualified"


def test_bulk_create_leads(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    payload = [
        {"first_name": "Ada"},
        {"first_name": "Alan"},
    ]
    response = request_factory("POST", "/api/v1/leads/bulk-create/", payload, format="json")
    assert response.status_code == 201
    assert len(response.json()) == 2


def test_merge_leads(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    source = LeadFactory(
        first_name="Source",
        company="SourceCo",
        score=80.0,
        emails=[{"email": "source@example.com", "type": "work"}],
    )
    target = LeadFactory(
        first_name="Target",
        company="",
        score=50.0,
        emails=[{"email": "target@example.com", "type": "work"}],
    )
    response = request_factory(
        "POST",
        "/api/v1/leads/merge/",
        {"source_id": source.pk, "target_id": target.pk},
        format="json",
    )
    assert response.status_code == 200, response.content
    target.refresh_from_db()
    assert target.company == "SourceCo"
    assert target.score == 80.0
    emails = {e["email"] for e in target.emails}
    assert "source@example.com" in emails
    assert "target@example.com" in emails
    source.refresh_from_db()
    assert source.deleted_at is not None


def test_convert_lead_creates_account_contact_deal(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    _seed_pipeline(active_tenant)
    lead = LeadFactory(
        first_name="Ada",
        last_name="Lovelace",
        company="Analytical Engine Co.",
        emails=[{"email": "ada@example.com", "type": "work"}],
        annual_revenue=Decimal("50000.00"),
    )
    response = request_factory("POST", f"/api/v1/leads/{lead.pk}/convert/", {}, format="json")
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["account"]["name"] == "Analytical Engine Co."
    assert body["contact"]["first_name"] == "Ada"
    assert body["deal"] is not None

    lead.refresh_from_db()
    assert lead.is_converted is True
    assert lead.lead_status == "converted"
    assert lead.converted_account_id is not None
    assert lead.converted_contact_id is not None
    assert lead.converted_deal_id is not None


def test_convert_lead_idempotent(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    _seed_pipeline(active_tenant)
    lead = LeadFactory()
    first = request_factory("POST", f"/api/v1/leads/{lead.pk}/convert/", {}, format="json")
    assert first.status_code == 201
    second = request_factory("POST", f"/api/v1/leads/{lead.pk}/convert/", {}, format="json")
    assert second.status_code == 200
    assert second.json()["detail"] == "Lead is already converted."


def test_convert_lead_without_deal(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    _seed_pipeline(active_tenant)
    lead = LeadFactory(company="No Deal Co.")
    response = request_factory(
        "POST",
        f"/api/v1/leads/{lead.pk}/convert/",
        {"create_deal": False},
        format="json",
    )
    assert response.status_code == 201
    body = response.json()
    assert body["deal"] is None
    lead.refresh_from_db()
    assert lead.converted_deal_id is None
    assert lead.converted_account_id is not None


def test_filter_by_lead_status(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    LeadFactory.create_batch(2, lead_status="new")
    LeadFactory.create_batch(1, lead_status="contacted")
    response = request_factory("GET", "/api/v1/leads/?lead_status=contacted")
    assert response.status_code == 200
    assert response.json()["count"] == 1


def test_filter_by_rating(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    LeadFactory.create_batch(2, rating="hot")
    LeadFactory.create_batch(1, rating="cold")
    response = request_factory("GET", "/api/v1/leads/?rating=hot")
    assert response.status_code == 200
    assert response.json()["count"] == 2


def test_sort_by_score(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    LeadFactory(score=10.0)
    LeadFactory(score=90.0)
    response = request_factory("GET", "/api/v1/leads/?sort=-score")
    scores = [r["score"] for r in response.json()["results"]]
    assert scores == [90.0, 10.0]
