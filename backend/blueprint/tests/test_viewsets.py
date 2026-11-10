"""ViewSet / API tests for the blueprint app.

Covers:

* ``BlueprintViewSet`` — list / create / retrieve + ``publish`` /
  ``archive`` / ``versions`` / ``preview`` actions.
* ``BlueprintStateViewSet`` — list (filter by blueprint) + create.
* ``BlueprintTransitionViewSet`` — list + ``field_requirements`` /
  ``assignments`` nested actions.
* ``BlueprintExecutionViewSet`` — list (filter by pipeline / deal /
  owner / is_complete / is_stuck) + ``available_transitions`` /
  ``execute_transition`` / ``compliance_report`` / ``stuck_deals``
  actions.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from blueprint.factories import (
    BlueprintFactory,
    BlueprintStateFactory,
    BlueprintTransitionFactory,
)
from blueprint.models import BlueprintExecution
from blueprint.services import BlueprintService
from deals.factories import DealFactory, PipelineFactory, StageFactory


pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def grant_blueprint_permissions(admin_role):  # type: ignore[no-untyped-def]
    """Grant ``blueprints.manage`` to the admin role so HasPermission passes.

    The shared ``admin_role`` fixture (in ``conftest.py``) carries only
    ``org.admin``. ``HasPermission("blueprints.manage")`` does a strict
    subset check on the role's permissions, so we add the
    ``blueprints.manage`` string here. The fixture is autouse=True so it
    runs before every test in this module.
    """
    if "blueprints.manage" not in (admin_role.permissions or []):
        admin_role.permissions = list(admin_role.permissions or []) + ["blueprints.manage"]
        admin_role.save(update_fields=["permissions"])
    return admin_role


###############################################################################
# BlueprintViewSet
###############################################################################


def test_list_blueprints(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    BlueprintFactory.create_batch(3, tenant=active_tenant)
    response = request_factory("GET", "/api/v1/blueprints/")
    assert response.status_code == 200, response.content
    assert response.json()["count"] == 3


def test_create_blueprint_requires_permission(request_factory, active_tenant):  # type: ignore[no-untyped-def]
    """A user without ``blueprints.manage`` cannot create a blueprint (403).

    The autouse ``grant_blueprint_permissions`` fixture adds
    ``blueprints.manage`` to the admin role, so the first POST succeeds.
    We then strip the role's permissions and assert the second POST is
    rejected with 403.
    """
    pipeline = PipelineFactory(tenant=active_tenant)
    response = request_factory(
        "POST",
        "/api/v1/blueprints/",
        {"name": "Sales Blueprint", "pipeline": pipeline.pk},
        format="json",
    )
    assert response.status_code == 201, response.content

    # Strip the role's permissions and retry — should be 403.
    from api.models import TenantMembership

    membership = TenantMembership.objects.get(
        tenant=active_tenant, user__email="crm-user@example.com"
    )
    membership.role.permissions = []
    membership.role.save(update_fields=["permissions"])
    response = request_factory(
        "POST",
        "/api/v1/blueprints/",
        {"name": "Second Blueprint", "pipeline": pipeline.pk},
        format="json",
    )
    assert response.status_code == 403


def test_create_blueprint(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    pipeline = PipelineFactory(tenant=active_tenant)
    response = request_factory(
        "POST",
        "/api/v1/blueprints/",
        {"name": "Sales Blueprint", "pipeline": pipeline.pk, "is_active": False},
        format="json",
    )
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["name"] == "Sales Blueprint"
    assert body["pipeline"] == pipeline.pk
    assert body["is_active"] is False


def test_publish_action_activates_blueprint(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    pipeline = PipelineFactory(tenant=active_tenant)
    bp = BlueprintFactory(tenant=active_tenant, pipeline=pipeline, is_active=False)
    response = request_factory("POST", f"/api/v1/blueprints/{bp.pk}/publish/")
    assert response.status_code == 200, response.content
    bp.refresh_from_db()
    assert bp.is_active is True
    assert bp.is_published is True
    assert bp.version == 2


def test_publish_action_deactivates_other_active(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    pipeline = PipelineFactory(tenant=active_tenant)
    bp1 = BlueprintFactory(tenant=active_tenant, pipeline=pipeline, is_active=True, version=1)
    bp2 = BlueprintFactory(tenant=active_tenant, pipeline=pipeline, is_active=False, version=1)
    request_factory("POST", f"/api/v1/blueprints/{bp2.pk}/publish/")
    bp1.refresh_from_db()
    bp2.refresh_from_db()
    assert bp1.is_active is False
    assert bp2.is_active is True


def test_archive_action_deactivates(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    pipeline = PipelineFactory(tenant=active_tenant)
    bp = BlueprintFactory(tenant=active_tenant, pipeline=pipeline, is_active=True, version=2)
    response = request_factory("POST", f"/api/v1/blueprints/{bp.pk}/archive/")
    assert response.status_code == 200, response.content
    bp.refresh_from_db()
    assert bp.is_active is False


def test_versions_action_lists_all(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    pipeline = PipelineFactory(tenant=active_tenant)
    BlueprintFactory(tenant=active_tenant, pipeline=pipeline, version=1)
    BlueprintFactory(tenant=active_tenant, pipeline=pipeline, version=2)
    bp3 = BlueprintFactory(tenant=active_tenant, pipeline=pipeline, version=3)
    response = request_factory("GET", f"/api/v1/blueprints/{bp3.pk}/versions/")
    assert response.status_code == 200, response.content
    body = response.json()
    assert len(body) == 3
    # Newest first.
    assert body[0]["version"] == 3


def test_preview_action_returns_transitions(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    pipeline = PipelineFactory(tenant=active_tenant)
    lead = StageFactory(tenant=active_tenant, pipeline=pipeline, name="Lead", order=0)
    qualified = StageFactory(tenant=active_tenant, pipeline=pipeline, name="Qualified", order=1)
    bp = BlueprintFactory(tenant=active_tenant, pipeline=pipeline, is_active=True)
    lead_state = BlueprintStateFactory(tenant=active_tenant, blueprint=bp, stage=lead)
    qualified_state = BlueprintStateFactory(tenant=active_tenant, blueprint=bp, stage=qualified)
    BlueprintTransitionFactory(
        tenant=active_tenant, blueprint=bp, from_state=lead_state, to_state=qualified_state
    )
    deal = DealFactory(tenant=active_tenant, pipeline=pipeline, stage=lead)
    response = request_factory(
        "POST",
        f"/api/v1/blueprints/{bp.pk}/preview/",
        {"deal_id": deal.pk},
        format="json",
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["deal_id"] == deal.pk
    assert body["current_state_id"] == lead_state.pk
    assert len(body["transitions"]) == 1


###############################################################################
# BlueprintStateViewSet
###############################################################################


def test_list_blueprint_states_filter_by_blueprint(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    bp = BlueprintFactory(tenant=active_tenant)
    other_bp = BlueprintFactory(tenant=active_tenant)
    BlueprintStateFactory.create_batch(2, tenant=active_tenant, blueprint=bp)
    BlueprintStateFactory(tenant=active_tenant, blueprint=other_bp)
    response = request_factory("GET", f"/api/v1/blueprint-states/?blueprint={bp.pk}")
    assert response.status_code == 200, response.content
    assert response.json()["count"] == 2


###############################################################################
# BlueprintTransitionViewSet
###############################################################################


def test_list_blueprint_transitions(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    bp = BlueprintFactory(tenant=active_tenant)
    from_state = BlueprintStateFactory(tenant=active_tenant, blueprint=bp)
    to_state = BlueprintStateFactory(tenant=active_tenant, blueprint=bp)
    BlueprintTransitionFactory(
        tenant=active_tenant, blueprint=bp, from_state=from_state, to_state=to_state
    )
    response = request_factory("GET", f"/api/v1/blueprint-transitions/?blueprint={bp.pk}")
    assert response.status_code == 200, response.content
    assert response.json()["count"] == 1


def test_field_requirements_action_creates(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    bp = BlueprintFactory(tenant=active_tenant)
    from_state = BlueprintStateFactory(tenant=active_tenant, blueprint=bp)
    to_state = BlueprintStateFactory(tenant=active_tenant, blueprint=bp)
    transition = BlueprintTransitionFactory(
        tenant=active_tenant, blueprint=bp, from_state=from_state, to_state=to_state
    )
    response = request_factory(
        "POST",
        f"/api/v1/blueprint-transitions/{transition.pk}/field-requirements/",
        {"field_name": "amount", "condition": "greater_than", "value": "10000"},
        format="json",
    )
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["field_name"] == "amount"
    assert body["condition"] == "greater_than"


def test_assignments_action_creates(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    bp = BlueprintFactory(tenant=active_tenant)
    from_state = BlueprintStateFactory(tenant=active_tenant, blueprint=bp)
    to_state = BlueprintStateFactory(tenant=active_tenant, blueprint=bp)
    transition = BlueprintTransitionFactory(
        tenant=active_tenant, blueprint=bp, from_state=from_state, to_state=to_state
    )
    response = request_factory(
        "POST",
        f"/api/v1/blueprint-transitions/{transition.pk}/assignments/",
        {"assign_to": "role", "assign_value": "closer"},
        format="json",
    )
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["assign_to"] == "role"
    assert body["assign_value"] == "closer"


###############################################################################
# BlueprintExecutionViewSet
###############################################################################


@pytest.fixture
def sales_blueprint_with_deal(active_tenant, user):  # type: ignore[no-untyped-def]
    """A pipeline + blueprint + 2 states + a transition + a deal with an execution."""
    pipeline = PipelineFactory(tenant=active_tenant)
    lead = StageFactory(tenant=active_tenant, pipeline=pipeline, name="Lead", order=0)
    qualified = StageFactory(
        tenant=active_tenant, pipeline=pipeline, name="Qualified", order=1
    )
    bp = BlueprintFactory(tenant=active_tenant, pipeline=pipeline, is_active=True)
    lead_state = BlueprintStateFactory(tenant=active_tenant, blueprint=bp, stage=lead)
    qualified_state = BlueprintStateFactory(tenant=active_tenant, blueprint=bp, stage=qualified)
    BlueprintTransitionFactory(
        tenant=active_tenant, blueprint=bp, from_state=lead_state, to_state=qualified_state
    )
    deal = DealFactory(
        tenant=active_tenant,
        pipeline=pipeline,
        stage=lead,
        amount=Decimal("5000.00"),
        owner=user,
    )
    execution = BlueprintService().enforce_on_create(deal)
    assert execution is not None
    return {
        "pipeline": pipeline,
        "blueprint": bp,
        "lead_state": lead_state,
        "qualified_state": qualified_state,
        "deal": deal,
        "execution": execution,
    }


def test_list_executions_filter_by_pipeline(request_factory, sales_blueprint_with_deal):  # type: ignore[no-untyped-def]
    response = request_factory(
        "GET",
        f"/api/v1/blueprint-executions/?pipeline={sales_blueprint_with_deal['pipeline'].pk}",
    )
    assert response.status_code == 200, response.content
    assert response.json()["count"] == 1


def test_list_executions_filter_by_deal(request_factory, sales_blueprint_with_deal):  # type: ignore[no-untyped-def]
    response = request_factory(
        "GET",
        f"/api/v1/blueprint-executions/?deal={sales_blueprint_with_deal['deal'].pk}",
    )
    assert response.status_code == 200, response.content
    assert response.json()["count"] == 1


def test_available_transitions_action(request_factory, sales_blueprint_with_deal):  # type: ignore[no-untyped-def]
    execution = sales_blueprint_with_deal["execution"]
    response = request_factory(
        "GET",
        f"/api/v1/blueprint-executions/{execution.pk}/available-transitions/",
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["execution_id"] == execution.pk
    assert len(body["transitions"]) == 1


def test_execute_transition_action_moves_deal(request_factory, sales_blueprint_with_deal, user):  # type: ignore[no-untyped-def]
    execution = sales_blueprint_with_deal["execution"]
    response = request_factory(
        "POST",
        f"/api/v1/blueprint-executions/{execution.pk}/execute-transition/",
        {
            "to_state": sales_blueprint_with_deal["qualified_state"].pk,
            "reason": "API move",
        },
        format="json",
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["current_state"] == sales_blueprint_with_deal["qualified_state"].pk
    deal = sales_blueprint_with_deal["deal"]
    deal.refresh_from_db()
    assert deal.stage_id == sales_blueprint_with_deal["qualified_state"].stage_id


def test_compliance_report_action(request_factory, sales_blueprint_with_deal):  # type: ignore[no-untyped-def]
    pipeline = sales_blueprint_with_deal["pipeline"]
    response = request_factory(
        "GET",
        f"/api/v1/blueprint-executions/compliance-report/?pipeline={pipeline.pk}",
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["total_deals"] == 1
    assert body["in_blueprint"] == 1
    assert body["compliance_rate"] == 1.0


def test_stuck_deals_action(request_factory, sales_blueprint_with_deal):  # type: ignore[no-untyped-def]
    pipeline = sales_blueprint_with_deal["pipeline"]
    lead_state = sales_blueprint_with_deal["lead_state"]
    lead_state.time_limit_hours = 24
    lead_state.save(update_fields=["time_limit_hours", "updated_at"])
    execution = sales_blueprint_with_deal["execution"]
    BlueprintExecution.objects.filter(pk=execution.pk).update(
        entered_state_at=timezone.now() - timedelta(hours=48)
    )
    response = request_factory(
        "GET",
        f"/api/v1/blueprint-executions/stuck-deals/?pipeline={pipeline.pk}",
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["count"] == 1
    assert body["results"][0]["deal_id"] == sales_blueprint_with_deal["deal"].pk


def test_is_stuck_filter(request_factory, sales_blueprint_with_deal):  # type: ignore[no-untyped-def]
    """``?is_stuck=true`` returns executions whose state has a time_limit and elapsed."""
    lead_state = sales_blueprint_with_deal["lead_state"]
    lead_state.time_limit_hours = 24
    lead_state.save(update_fields=["time_limit_hours", "updated_at"])
    execution = sales_blueprint_with_deal["execution"]
    BlueprintExecution.objects.filter(pk=execution.pk).update(
        entered_state_at=timezone.now() - timedelta(hours=48)
    )
    response = request_factory(
        "GET",
        "/api/v1/blueprint-executions/?is_stuck=true",
    )
    assert response.status_code == 200, response.content
    assert response.json()["count"] == 1


def test_execute_transition_requires_permission(request_factory, sales_blueprint_with_deal):  # type: ignore[no-untyped-def]
    """Non-admin user (no ``blueprints.manage``) gets 403 on execute_transition."""
    from api.models import TenantMembership

    membership = TenantMembership.objects.get(
        tenant=sales_blueprint_with_deal["blueprint"].tenant,
        user__email="crm-user@example.com",
    )
    membership.role.permissions = []
    membership.role.save(update_fields=["permissions"])
    execution = sales_blueprint_with_deal["execution"]
    response = request_factory(
        "POST",
        f"/api/v1/blueprint-executions/{execution.pk}/execute-transition/",
        {"to_state": sales_blueprint_with_deal["qualified_state"].pk},
        format="json",
    )
    assert response.status_code == 403
