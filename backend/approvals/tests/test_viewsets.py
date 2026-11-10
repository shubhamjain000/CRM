"""ViewSet / API tests for the approvals app.

Covers:

* :class:`ApprovalProcessViewSet` — list / create + nested ``steps``
  action.
* :class:`ApprovalRequestViewSet` — list / create + ``approve`` /
  ``reject`` / ``delegate`` / ``recall`` / ``bulk_approve`` / ``pending``
  / ``my_requests`` / ``actions`` actions.
* :class:`ApprovalDelegationViewSet` — list / create / update.
"""

from __future__ import annotations

import pytest

from approvals.factories import (
    ApprovalProcessFactory,
    ApprovalRequestFactory,
    ApprovalStepFactory,
)
from approvals.models import STATUS_PENDING, STEP_SEQUENTIAL


pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def grant_approvals_permissions(admin_role):  # type: ignore[no-untyped-def]
    """Grant ``approvals.manage`` to the admin role so HasPermission passes."""
    if "approvals.manage" not in (admin_role.permissions or []):
        admin_role.permissions = list(admin_role.permissions or []) + ["approvals.manage"]
        admin_role.save(update_fields=["permissions"])
    return admin_role


###############################################################################
# ApprovalProcessViewSet
###############################################################################


def test_list_approval_processes(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    ApprovalProcessFactory.create_batch(3, tenant=active_tenant)
    response = request_factory("GET", "/api/v1/approval-processes/")
    assert response.status_code == 200, response.content
    assert response.json()["count"] == 3


def test_create_approval_process(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    response = request_factory(
        "POST",
        "/api/v1/approval-processes/",
        {
            "name": "Big Deal Approval",
            "target_model": "deal",
            "trigger_criteria": {"amount": {"$gt": 50000}},
            "is_active": True,
        },
        format="json",
    )
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["name"] == "Big Deal Approval"
    assert body["target_model"] == "deal"
    assert body["trigger_criteria"] == {"amount": {"$gt": 50000}}
    assert body["version"] == 1


def test_steps_action_lists_ordered_steps(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    process = ApprovalProcessFactory(tenant=active_tenant)
    ApprovalStepFactory(tenant=active_tenant, process=process, order=1)
    ApprovalStepFactory(tenant=active_tenant, process=process, order=0)
    response = request_factory("GET", f"/api/v1/approval-processes/{process.pk}/steps/")
    assert response.status_code == 200, response.content
    body = response.json()
    assert len(body) == 2
    assert body[0]["order"] == 0
    assert body[1]["order"] == 1


def test_steps_action_creates_step(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    process = ApprovalProcessFactory(tenant=active_tenant)
    response = request_factory(
        "POST",
        f"/api/v1/approval-processes/{process.pk}/steps/",
        {
            "order": 0,
            "step_type": "sequential",
            "approvers": [{"type": "user", "value": user.pk}],
        },
        format="json",
    )
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["process"] == process.pk
    assert body["approvers"] == [{"type": "user", "value": user.pk}]


###############################################################################
# ApprovalRequestViewSet
###############################################################################


def test_list_approval_requests(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    ApprovalRequestFactory.create_batch(2, tenant=active_tenant)
    response = request_factory("GET", "/api/v1/approval-requests/")
    assert response.status_code == 200, response.content
    assert response.json()["count"] == 2


def test_create_approval_request_via_service(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    process = ApprovalProcessFactory(tenant=active_tenant, name="Proc")
    ApprovalStepFactory(
        tenant=active_tenant,
        process=process,
        order=0,
        step_type=STEP_SEQUENTIAL,
        approvers=[{"type": "user", "value": user.pk}],
    )
    response = request_factory(
        "POST",
        "/api/v1/approval-requests/",
        {
            "process": process.pk,
            "target_module": "deal",
            "target_id": "42",
            "target_name": "Big Deal",
        },
        format="json",
    )
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["target_module"] == "deal"
    assert body["status"] == STATUS_PENDING


def test_approve_action_advances(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    process = ApprovalProcessFactory(tenant=active_tenant)
    ApprovalStepFactory(
        tenant=active_tenant,
        process=process,
        order=0,
        step_type=STEP_SEQUENTIAL,
        approvers=[{"type": "user", "value": user.pk}],
    )
    request = ApprovalRequestFactory(
        tenant=active_tenant, process=process, current_step=process.steps.first()
    )
    response = request_factory(
        "POST",
        f"/api/v1/approval-requests/{request.pk}/approve/",
        {"comment": "ok"},
        format="json",
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["status"] == "approved"


def test_reject_action_flips_status(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    process = ApprovalProcessFactory(tenant=active_tenant)
    ApprovalStepFactory(tenant=active_tenant, process=process, order=0, step_type=STEP_SEQUENTIAL)
    request = ApprovalRequestFactory(
        tenant=active_tenant, process=process, current_step=process.steps.first()
    )
    response = request_factory(
        "POST",
        f"/api/v1/approval-requests/{request.pk}/reject/",
        {"comment": "no"},
        format="json",
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["status"] == "rejected"


def test_recall_action(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    process = ApprovalProcessFactory(tenant=active_tenant)
    ApprovalStepFactory(tenant=active_tenant, process=process, order=0, step_type=STEP_SEQUENTIAL)
    request = ApprovalRequestFactory(
        tenant=active_tenant,
        process=process,
        current_step=process.steps.first(),
        submitted_by=user,
    )
    response = request_factory(
        "POST",
        f"/api/v1/approval-requests/{request.pk}/recall/",
        format="json",
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["status"] == "recalled"


def test_pending_action_returns_requests_for_user(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    process = ApprovalProcessFactory(tenant=active_tenant)
    ApprovalStepFactory(
        tenant=active_tenant,
        process=process,
        order=0,
        step_type=STEP_SEQUENTIAL,
        approvers=[{"type": "user", "value": user.pk}],
    )
    ApprovalRequestFactory(
        tenant=active_tenant, process=process, current_step=process.steps.first()
    )
    response = request_factory("GET", "/api/v1/approval-requests/pending/")
    assert response.status_code == 200, response.content
    body = response.json()
    # Either paginated or flat.
    results = body.get("results", body)
    assert len(results) == 1


def test_my_requests_action(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    ApprovalRequestFactory(tenant=active_tenant, submitted_by=user)
    response = request_factory("GET", "/api/v1/approval-requests/my-requests/")
    assert response.status_code == 200, response.content
    body = response.json()
    results = body.get("results", body)
    assert len(results) == 1


def test_actions_action_returns_audit_log(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    from approvals.factories import ApprovalActionFactory

    request = ApprovalRequestFactory(tenant=active_tenant, submitted_by=user)
    ApprovalActionFactory(tenant=active_tenant, request=request, approver=user, action="approve")
    response = request_factory("GET", f"/api/v1/approval-requests/{request.pk}/actions/")
    assert response.status_code == 200, response.content
    body = response.json()
    assert len(body) == 1
    assert body[0]["action"] == "approve"


def test_bulk_approve_action(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    process = ApprovalProcessFactory(tenant=active_tenant)
    ApprovalStepFactory(
        tenant=active_tenant,
        process=process,
        order=0,
        step_type=STEP_SEQUENTIAL,
        approvers=[{"type": "user", "value": user.pk}],
    )
    r1 = ApprovalRequestFactory(
        tenant=active_tenant, process=process, current_step=process.steps.first()
    )
    r2 = ApprovalRequestFactory(
        tenant=active_tenant, process=process, current_step=process.steps.first()
    )
    response = request_factory(
        "POST",
        "/api/v1/approval-requests/bulk-approve/",
        {"ids": [r1.pk, r2.pk], "comment": "ok"},
        format="json",
    )
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["approved"] == 2


###############################################################################
# ApprovalDelegationViewSet
###############################################################################


def test_create_delegation(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    from api.factories import UserFactory

    delegate = UserFactory(email="del@example.com")
    response = request_factory(
        "POST",
        "/api/v1/approval-delegations/",
        {
            "delegate_to": delegate.pk,
            "start_date": "2024-01-01",
            "end_date": "2024-01-07",
            "is_active": True,
        },
        format="json",
    )
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["delegate_to"] == delegate.pk
    assert body["user"] == user.pk  # auto-stamped


def test_list_delegations(request_factory, active_tenant, user):  # type: ignore[no-untyped-def]
    from approvals.factories import ApprovalDelegationFactory

    ApprovalDelegationFactory(tenant=active_tenant, user=user)
    response = request_factory("GET", "/api/v1/approval-delegations/")
    assert response.status_code == 200, response.content
    body = response.json()
    results = body.get("results", body)
    assert len(results) == 1
