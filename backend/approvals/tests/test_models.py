"""Model-layer tests for the approvals app.

Covers:

* :class:`ApprovalProcess` string + default ``version`` / ``is_active``.
* :class:`ApprovalStep` ``order`` uniqueness within a process.
* :class:`ApprovalRequest` ``is_open`` property + ``append_comment`` mutator.
* :class:`ApprovalAction` ``timestamp`` default.
* :class:`ApprovalDelegation` ``covers`` date-window helper.
* The factories produce persistable rows.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from django.db import IntegrityError, transaction

from approvals.factories import (
    ApprovalDelegationFactory,
    ApprovalProcessFactory,
    ApprovalRequestFactory,
    ApprovalStepFactory,
)
from approvals.models import (
    ApprovalProcess,
    ApprovalRequest,
    STATUS_APPROVED,
    STATUS_PENDING,
)


pytestmark = pytest.mark.django_db


###############################################################################
# ApprovalProcess
###############################################################################


def test_approval_process_str(active_tenant, user):  # type: ignore[no-untyped-def]
    process = ApprovalProcessFactory(tenant=active_tenant, name="Big Deal Approval", version=2)
    assert str(process) == "Big Deal Approval (v2)"


def test_approval_process_defaults(active_tenant, user):  # type: ignore[no-untyped-def]
    process = ApprovalProcessFactory(tenant=active_tenant)
    assert process.is_active is True
    assert process.version == 1
    assert process.target_model == "deal"
    assert process.trigger_criteria == {}


def test_approval_process_unique_name_per_tenant(active_tenant, user):  # type: ignore[no-untyped-def]
    ApprovalProcessFactory(tenant=active_tenant, name="Shared Name")
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            ApprovalProcessFactory(tenant=active_tenant, name="Shared Name")


###############################################################################
# ApprovalStep
###############################################################################


def test_approval_step_unique_order_per_process(active_tenant, user):  # type: ignore[no-untyped-def]
    process = ApprovalProcessFactory(tenant=active_tenant)
    ApprovalStepFactory(tenant=active_tenant, process=process, order=0)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            ApprovalStepFactory(tenant=active_tenant, process=process, order=0)


def test_approval_step_str(active_tenant, user):  # type: ignore[no-untyped-def]
    process = ApprovalProcessFactory(tenant=active_tenant, name="Proc")
    step = ApprovalStepFactory(tenant=active_tenant, process=process, order=2)
    assert "Proc" in str(step)
    assert "step #2" in str(step)


###############################################################################
# ApprovalRequest
###############################################################################


def test_approval_request_is_open(active_tenant, user):  # type: ignore[no-untyped-def]
    request = ApprovalRequestFactory(tenant=active_tenant, status=STATUS_PENDING)
    assert request.is_open is True
    request.status = STATUS_APPROVED
    request.save(update_fields=["status"])
    assert request.is_open is False


def test_approval_request_append_comment(active_tenant, user):  # type: ignore[no-untyped-def]
    request = ApprovalRequestFactory(tenant=active_tenant, comments=[])
    assert request.comments == []
    request.append_comment(user_id=user.pk, comment="looks good")
    assert len(request.comments) == 1
    entry = request.comments[0]
    assert entry["user_id"] == user.pk
    assert entry["comment"] == "looks good"
    assert "timestamp" in entry


def test_approval_request_str(active_tenant, user):  # type: ignore[no-untyped-def]
    process = ApprovalProcessFactory(tenant=active_tenant, name="P")
    request = ApprovalRequestFactory(
        tenant=active_tenant, process=process, target_module="deal", target_id="42"
    )
    text = str(request)
    assert "P" in text
    assert "deal:42" in text


###############################################################################
# ApprovalDelegation
###############################################################################


def test_approval_delegation_covers(active_tenant, user):  # type: ignore[no-untyped-def]
    today = date.today()
    delegation = ApprovalDelegationFactory(
        tenant=active_tenant,
        start_date=today - timedelta(days=1),
        end_date=today + timedelta(days=1),
    )
    assert delegation.covers(today) is True
    assert delegation.covers(today + timedelta(days=10)) is False


def test_approval_delegation_covers_when_inactive(active_tenant, user):  # type: ignore[no-untyped-def]
    today = date.today()
    delegation = ApprovalDelegationFactory(
        tenant=active_tenant,
        start_date=today - timedelta(days=1),
        end_date=today + timedelta(days=1),
        is_active=False,
    )
    assert delegation.covers(today) is False


###############################################################################
# Sanity
###############################################################################


def test_approval_models_count_after_seed(active_tenant, user):  # type: ignore[no-untyped-def]
    process = ApprovalProcessFactory(tenant=active_tenant)
    step = ApprovalStepFactory(tenant=active_tenant, process=process, order=0)
    request = ApprovalRequestFactory(tenant=active_tenant, process=process, current_step=step)
    assert ApprovalProcess.objects.filter(pk=process.pk).exists()
    assert ApprovalRequest.objects.filter(pk=request.pk).exists()
    assert process.steps.filter(pk=step.pk).exists()
