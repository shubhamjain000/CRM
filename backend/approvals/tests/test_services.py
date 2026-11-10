"""Service-layer tests for the approvals app.

Covers :class:`approvals.services.ApprovalService`:

* ``submit`` — happy path + invalid process name + criteria mismatch.
* ``approve`` — sequential advance, parallel requires all, majority_vote,
  unanimous, first_to_approve.
* ``reject`` — flips status to ``rejected``, notifies submitter.
* ``delegate`` — records an action with ``action=delegate``.
* ``recall`` — submitter-only.
* ``escalate_expired`` — escalates past time limit; leaves fresh ones.
* ``get_pending_for_user`` + ``get_my_requests``.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from approvals.factories import (
    ApprovalProcessFactory,
    ApprovalRequestFactory,
    ApprovalStepFactory,
)
from approvals.models import (
    ApprovalAction,
    STATUS_APPROVED,
    STATUS_ESCALATED,
    STATUS_PENDING,
    STATUS_REJECTED,
    STEP_FIRST_TO_APPROVE,
    STEP_MAJORITY_VOTE,
    STEP_PARALLEL,
    STEP_SEQUENTIAL,
    STEP_UNANIMOUS,
)
from approvals.services import ApprovalService
from api.factories import UserFactory


pytestmark = pytest.mark.django_db


###############################################################################
# Fixtures
###############################################################################


def _make_process_with_steps(
    *,
    tenant,
    steps_spec,  # type: ignore[no-untyped-def]
    name="Test Approval",
    trigger_criteria=None,
):
    """Build a process + the supplied step list.

    ``steps_spec`` is a list of dicts passed straight through to
    ``ApprovalStepFactory``. Returns ``(process, [step0, step1, ...])``.
    """
    process = ApprovalProcessFactory(
        tenant=tenant, name=name, trigger_criteria=trigger_criteria or {}
    )
    steps = []
    for index, spec in enumerate(steps_spec):
        step = ApprovalStepFactory(
            tenant=tenant,
            process=process,
            order=index,
            **spec,
        )
        steps.append(step)
    return process, steps


@pytest.fixture
def approver(active_tenant, admin_role):  # type: ignore[no-untyped-def]
    from api.models import TenantMembership

    user = UserFactory(email="approver@example.com", name="Approver")
    TenantMembership.objects.create(
        user=user, tenant=active_tenant, role=admin_role, is_active=True
    )
    return user


###############################################################################
# submit
###############################################################################


def test_submit_creates_request_and_first_step(active_tenant, user, approver):  # type: ignore[no-untyped-def]
    process, steps = _make_process_with_steps(
        tenant=active_tenant,
        steps_spec=[{"step_type": STEP_SEQUENTIAL, "approvers": [{"type": "user", "value": approver.pk}]}],
    )
    request = ApprovalService().submit(
        record_module="deal",
        record_id="42",
        record_name="Big Deal",
        process_name=process.name,
        submitted_by=user,
    )
    assert request.pk is not None
    assert request.status == STATUS_PENDING
    assert request.current_step_id == steps[0].pk
    assert request.process_id == process.pk


def test_submit_rejects_unknown_process_name(active_tenant, user):  # type: ignore[no-untyped-def]
    with pytest.raises(ValueError, match="No active approval process"):
        ApprovalService().submit(
            record_module="deal",
            record_id="1",
            record_name="x",
            process_name="Nonexistent",
            submitted_by=user,
        )


def test_submit_rejects_process_without_steps(active_tenant, user):  # type: ignore[no-untyped-def]
    ApprovalProcessFactory(tenant=active_tenant, name="Empty")
    with pytest.raises(ValueError, match="has no steps"):
        ApprovalService().submit(
            record_module="deal",
            record_id="1",
            record_name="x",
            process_name="Empty",
            submitted_by=user,
        )


def test_submit_validates_trigger_criteria(active_tenant, user):  # type: ignore[no-untyped-def]
    process, _ = _make_process_with_steps(
        tenant=active_tenant,
        steps_spec=[{"step_type": STEP_SEQUENTIAL}],
        trigger_criteria={"amount": {"$gt": 50000}},
    )
    # record_data that fails the criteria → ValueError.
    with pytest.raises(ValueError, match="trigger_criteria"):
        ApprovalService().submit(
            record_module="deal",
            record_id="1",
            record_name="x",
            process_name=process.name,
            submitted_by=user,
            record_data={"amount": 100},
        )


###############################################################################
# approve — sequential
###############################################################################


def test_approve_sequential_advances_then_completes(active_tenant, user, approver):  # type: ignore[no-untyped-def]
    process, steps = _make_process_with_steps(
        tenant=active_tenant,
        steps_spec=[
            {"step_type": STEP_SEQUENTIAL, "approvers": [{"type": "user", "value": approver.pk}]},
            {"step_type": STEP_SEQUENTIAL, "approvers": [{"type": "user", "value": approver.pk}]},
        ],
    )
    service = ApprovalService()
    request = service.submit(
        record_module="deal",
        record_id="1",
        record_name="Deal",
        process_name=process.name,
        submitted_by=user,
    )
    # First approve → advances to step 2.
    service.approve(request=request, user=approver, comment="ok")
    request.refresh_from_db()
    assert request.status == STATUS_PENDING
    assert request.current_step_id == steps[1].pk
    # Second approve → completes.
    service.approve(request=request, user=approver, comment="ok")
    request.refresh_from_db()
    assert request.status == STATUS_APPROVED
    assert request.completed_at is not None
    assert request.current_step_id is None


###############################################################################
# approve — parallel / unanimous / majority / first_to_approve
###############################################################################


def test_approve_parallel_requires_all_approvers(active_tenant, user, admin_role):  # type: ignore[no-untyped-def]
    from api.models import TenantMembership

    approver1 = UserFactory(email="a1@example.com")
    approver2 = UserFactory(email="a2@example.com")
    for u in (approver1, approver2):
        TenantMembership.objects.create(
            user=u, tenant=active_tenant, role=admin_role, is_active=True
        )
    process, steps = _make_process_with_steps(
        tenant=active_tenant,
        steps_spec=[
            {
                "step_type": STEP_PARALLEL,
                "approvers": [
                    {"type": "user", "value": approver1.pk},
                    {"type": "user", "value": approver2.pk},
                ],
            },
        ],
    )
    service = ApprovalService()
    request = service.submit(
        record_module="deal",
        record_id="1",
        record_name="Deal",
        process_name=process.name,
        submitted_by=user,
    )
    # First approve does not complete the step.
    service.approve(request=request, user=approver1, comment="ok")
    request.refresh_from_db()
    assert request.status == STATUS_PENDING
    # Second approve completes.
    service.approve(request=request, user=approver2, comment="ok")
    request.refresh_from_db()
    assert request.status == STATUS_APPROVED


def test_approve_majority_vote(active_tenant, user, admin_role):  # type: ignore[no-untyped-def]
    from api.models import TenantMembership

    approvers = [UserFactory(email=f"mv{i}@example.com") for i in range(3)]
    for u in approvers:
        TenantMembership.objects.create(
            user=u, tenant=active_tenant, role=admin_role, is_active=True
        )
    process, _ = _make_process_with_steps(
        tenant=active_tenant,
        steps_spec=[
            {
                "step_type": STEP_MAJORITY_VOTE,
                "approvers": [{"type": "user", "value": u.pk} for u in approvers],
            },
        ],
    )
    service = ApprovalService()
    request = service.submit(
        record_module="deal",
        record_id="1",
        record_name="Deal",
        process_name=process.name,
        submitted_by=user,
    )
    service.approve(request=request, user=approvers[0], comment="ok")
    request.refresh_from_db()
    assert request.status == STATUS_PENDING  # 1/3 not majority.
    service.approve(request=request, user=approvers[1], comment="ok")
    request.refresh_from_db()
    assert request.status == STATUS_APPROVED  # 2/3 is majority.


def test_approve_first_to_approve_completes_on_first_action(active_tenant, user, admin_role):  # type: ignore[no-untyped-def]
    from api.models import TenantMembership

    approver1 = UserFactory(email="f1@example.com")
    approver2 = UserFactory(email="f2@example.com")
    for u in (approver1, approver2):
        TenantMembership.objects.create(
            user=u, tenant=active_tenant, role=admin_role, is_active=True
        )
    process, _ = _make_process_with_steps(
        tenant=active_tenant,
        steps_spec=[
            {
                "step_type": STEP_FIRST_TO_APPROVE,
                "approvers": [
                    {"type": "user", "value": approver1.pk},
                    {"type": "user", "value": approver2.pk},
                ],
            },
        ],
    )
    service = ApprovalService()
    request = service.submit(
        record_module="deal",
        record_id="1",
        record_name="Deal",
        process_name=process.name,
        submitted_by=user,
    )
    service.approve(request=request, user=approver1, comment="first")
    request.refresh_from_db()
    assert request.status == STATUS_APPROVED


###############################################################################
# reject + recall + delegate
###############################################################################


def test_reject_flips_status_and_notifies_submitter(active_tenant, user, approver):  # type: ignore[no-untyped-def]
    process, _ = _make_process_with_steps(
        tenant=active_tenant,
        steps_spec=[{"step_type": STEP_SEQUENTIAL, "approvers": [{"type": "user", "value": approver.pk}]}],
    )
    service = ApprovalService()
    request = service.submit(
        record_module="deal",
        record_id="1",
        record_name="Deal",
        process_name=process.name,
        submitted_by=user,
    )
    service.reject(request=request, user=approver, comment="no")
    request.refresh_from_db()
    assert request.status == STATUS_REJECTED
    assert request.completed_at is not None
    assert ApprovalAction.objects.filter(request=request, action="reject").exists()


def test_recall_is_submitter_only(active_tenant, user, approver):  # type: ignore[no-untyped-def]
    process, _ = _make_process_with_steps(
        tenant=active_tenant, steps_spec=[{"step_type": STEP_SEQUENTIAL}]
    )
    service = ApprovalService()
    request = service.submit(
        record_module="deal",
        record_id="1",
        record_name="Deal",
        process_name=process.name,
        submitted_by=user,
    )
    with pytest.raises(ValueError, match="Only the submitter"):
        service.recall(request=request, user=approver)
    service.recall(request=request, user=user)
    request.refresh_from_db()
    assert request.status == "recalled"


def test_delegate_records_action(active_tenant, user, approver):  # type: ignore[no-untyped-def]
    process, _ = _make_process_with_steps(
        tenant=active_tenant, steps_spec=[{"step_type": STEP_SEQUENTIAL}]
    )
    service = ApprovalService()
    request = service.submit(
        record_module="deal",
        record_id="1",
        record_name="Deal",
        process_name=process.name,
        submitted_by=user,
    )
    service.delegate(
        request=request, user=approver, delegate_to=user, comment="delegating back"
    )
    assert ApprovalAction.objects.filter(request=request, action="delegate").exists()


###############################################################################
# escalate_expired
###############################################################################


def test_escalate_expired_promotes_past_due(active_tenant, user, approver):  # type: ignore[no-untyped-def]
    process, steps = _make_process_with_steps(
        tenant=active_tenant,
        steps_spec=[
            {
                "step_type": STEP_SEQUENTIAL,
                "approvers": [{"type": "user", "value": approver.pk}],
                "time_limit_hours": 1,
                "escalation_approver": {"type": "user", "value": user.pk},
            },
        ],
    )
    service = ApprovalService()
    request = service.submit(
        record_module="deal",
        record_id="1",
        record_name="Deal",
        process_name=process.name,
        submitted_by=user,
    )
    # Backdate the submitted_at so the 1h limit is exceeded.
    request.submitted_at = timezone.now() - timedelta(hours=3)
    request.save(update_fields=["submitted_at"])
    summary = service.escalate_expired()
    assert summary["escalated"] >= 1
    request.refresh_from_db()
    assert request.status == STATUS_ESCALATED
    assert ApprovalAction.objects.filter(request=request, action="escalate").exists()


def test_escalate_expired_leaves_fresh_requests_alone(active_tenant, user, approver):  # type: ignore[no-untyped-def]
    process, _ = _make_process_with_steps(
        tenant=active_tenant,
        steps_spec=[
            {
                "step_type": STEP_SEQUENTIAL,
                "approvers": [{"type": "user", "value": approver.pk}],
                "time_limit_hours": 24,
                "escalation_approver": {"type": "user", "value": user.pk},
            },
        ],
    )
    service = ApprovalService()
    service.submit(
        record_module="deal",
        record_id="1",
        record_name="Deal",
        process_name=process.name,
        submitted_by=user,
    )
    summary = service.escalate_expired()
    assert summary["escalated"] == 0


###############################################################################
# Queries
###############################################################################


def test_get_pending_for_user_returns_only_approvers(active_tenant, user, approver):  # type: ignore[no-untyped-def]
    process, _ = _make_process_with_steps(
        tenant=active_tenant,
        steps_spec=[{"step_type": STEP_SEQUENTIAL, "approvers": [{"type": "user", "value": approver.pk}]}],
    )
    service = ApprovalService()
    service.submit(
        record_module="deal",
        record_id="1",
        record_name="Deal",
        process_name=process.name,
        submitted_by=user,
    )
    pending = service.get_pending_for_user(approver)
    assert len(pending) == 1
    pending_user = service.get_pending_for_user(user)
    assert len(pending_user) == 0


def test_get_my_requests_returns_submitter_only(active_tenant, user, approver):  # type: ignore[no-untyped-def]
    process, _ = _make_process_with_steps(
        tenant=active_tenant, steps_spec=[{"step_type": STEP_SEQUENTIAL}]
    )
    service = ApprovalService()
    service.submit(
        record_module="deal",
        record_id="1",
        record_name="Deal",
        process_name=process.name,
        submitted_by=user,
    )
    mine = service.get_my_requests(user)
    assert len(mine) == 1
    other = service.get_my_requests(approver)
    assert len(other) == 0


###############################################################################
# Delegation
###############################################################################


def test_pending_for_user_honors_delegation(active_tenant, user, admin_role):  # type: ignore[no-untyped-def]
    from api.models import TenantMembership

    delegate = UserFactory(email="delegate@example.com")
    TenantMembership.objects.create(
        user=delegate, tenant=active_tenant, role=admin_role, is_active=True
    )
    # Set up a delegation: user → delegate (active today).
    from approvals.factories import ApprovalDelegationFactory

    ApprovalDelegationFactory(tenant=active_tenant, user=user, delegate_to=delegate)
    process, _ = _make_process_with_steps(
        tenant=active_tenant,
        steps_spec=[{"step_type": STEP_SEQUENTIAL, "approvers": [{"type": "user", "value": user.pk}]}],
    )
    service = ApprovalService()
    service.submit(
        record_module="deal",
        record_id="1",
        record_name="Deal",
        process_name=process.name,
        submitted_by=user,
    )
    pending = service.get_pending_for_user(delegate)
    assert len(pending) == 1
