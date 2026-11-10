"""Service-layer tests for the ai_core app."""

from __future__ import annotations

from decimal import Decimal

import pytest

from ai_core.models import AICostLog, PromptTemplate, TASK_CHAT
from ai_core.services import (
    activate_template,
    call_llm,
    check_budget,
    get_active_template,
    stream_llm,
)


pytestmark = pytest.mark.django_db


def test_call_llm_logs_cost_row(active_tenant):  # type: ignore[no-untyped-def]
    resp = call_llm(
        [{"role": "user", "content": "Hello there"}],
        model="gpt-4o-mini",
        tenant=active_tenant,
    )
    assert resp["model"] == "gpt-4o-mini"
    assert resp["input_tokens"] > 0
    assert Decimal(resp["cost"]) > 0
    assert AICostLog.objects.filter(tenant=active_tenant).count() == 1


def test_check_budget_returns_remaining(active_tenant):  # type: ignore[no-untyped-def]
    call_llm(
        [{"role": "user", "content": "x"}],
        model="gpt-4o-mini",
        tenant=active_tenant,
        task_type=TASK_CHAT,
    )
    budget = check_budget(tenant=active_tenant)
    assert Decimal(budget["spent"]) > 0
    assert Decimal(budget["remaining"]) >= 0


def test_stream_llm_yields_chunks(active_tenant):  # type: ignore[no-untyped-def]
    chunks = list(
        stream_llm(
            [{"role": "user", "content": "Hello world"}],
            model="gpt-4o-mini",
            tenant=active_tenant,
            chunk_size=8,
        )
    )
    assert len(chunks) >= 1
    assert "".join(chunks).startswith("[gpt-4o-mini")


def test_activate_template_flips_siblings_inactive(active_tenant):  # type: ignore[no-untyped-def]
    v1 = PromptTemplate.objects.create(
        tenant=active_tenant, name="greet", version=1, is_active=True,
    )
    v2 = PromptTemplate.objects.create(
        tenant=active_tenant, name="greet", version=2, is_active=False,
    )
    activate_template(v2)
    v1.refresh_from_db()
    assert v1.is_active is False
    assert v2.is_active is True
    assert get_active_template("greet", tenant=active_tenant).pk == v2.pk
