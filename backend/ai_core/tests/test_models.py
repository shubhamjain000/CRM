"""Model-layer tests for the ai_core app."""

from __future__ import annotations

from decimal import Decimal

import pytest

from ai_core.models import (
    AICostLog,
    PromptTemplate,
    TASK_CHAT,
)


pytestmark = pytest.mark.django_db


def test_costlog_str_and_defaults(active_tenant):  # type: ignore[no-untyped-def]
    log = AICostLog.objects.create(
        tenant=active_tenant,
        model="gpt-4o-mini",
        input_tokens=10,
        output_tokens=5,
        cost=Decimal("0.001"),
        task_type=TASK_CHAT,
    )
    assert "gpt-4o-mini" in str(log)
    assert log.task_type == TASK_CHAT
    assert log.cost == Decimal("0.001")


def test_prompt_template_unique_per_tenant_name_version(active_tenant):  # type: ignore[no-untyped-def]
    PromptTemplate.objects.create(
        tenant=active_tenant, name="greet", version=1, is_active=True,
    )
    with pytest.raises(Exception):  # noqa: PT011
        PromptTemplate.objects.create(
            tenant=active_tenant, name="greet", version=1, is_active=False,
        )
