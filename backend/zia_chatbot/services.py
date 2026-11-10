"""Service layer for the zia_chatbot app.

* :func:`chat` — append the user message to the conversation, build the
  LLM messages payload (system prompt + history + new user message),
  call :func:`ai_core.services.call_llm`, append the assistant response,
  persist, and return ``{content, tool_calls, conversation_id}``.
* :func:`get_history` — return the messages list for the user's
  conversation (creating an empty one when none exists).
* :func:`clear_history` — wipe the messages list (keeps the row so the
  ``(tenant, user)`` unique constraint stays satisfied).
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from django.utils import timezone

from .models import SYSTEM_PROMPT, ZiaConversation

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import User

log = logging.getLogger(__name__)

_MAX_HISTORY_TURNS = 20


def _get_or_create_conversation(user: "User") -> ZiaConversation:
    from api.managers import get_current_tenant  # noqa: PLC0415

    tenant = get_current_tenant()
    if tenant is None:
        membership = user.memberships.filter(is_active=True).first()
        if membership is None:
            raise RuntimeError("user has no active tenant membership")
        tenant = membership.tenant
    convo, _ = ZiaConversation.objects.get_or_create(
        tenant=tenant,
        user=user,
    )
    return convo


def chat(user: "User", message: str) -> dict[str, Any]:
    """Send ``message`` to Zia and return the assistant's response.

    Returns ``{content, tool_calls, conversation_id}``.
    """
    from ai_core.services import call_llm  # noqa: PLC0415

    convo = _get_or_create_conversation(user)
    now_iso = timezone.now().isoformat()
    convo.messages.append(
        {"role": "user", "content": message, "timestamp": now_iso}
    )

    # Build the LLM payload — system prompt + last N turns.
    history = convo.messages[-_MAX_HISTORY_TURNS:]
    llm_messages: list[dict[str, str]] = [
        {"role": "system", "content": SYSTEM_PROMPT}
    ]
    for turn in history:
        llm_messages.append({"role": turn["role"], "content": turn["content"]})

    response = call_llm(
        llm_messages,
        model="gpt-4o-mini",
        task_type="chat",
        tenant=convo.tenant,
    )

    # Stub: no tool_calls are produced by the deterministic echo; in
    # production the LLM SDK would return tool_calls and we'd dispatch
    # them through the appropriate service.
    convo.messages.append(
        {
            "role": "assistant",
            "content": response["content"],
            "timestamp": timezone.now().isoformat(),
            "tool_calls": [],
        }
    )
    convo.save(update_fields=["messages", "updated_at"])
    return {
        "content": response["content"],
        "tool_calls": [],
        "conversation_id": convo.pk,
    }


def get_history(user: "User") -> ZiaConversation:
    """Return the user's conversation (creating an empty one if missing)."""
    return _get_or_create_conversation(user)


def clear_history(user: "User") -> ZiaConversation:
    """Wipe the messages list on the user's conversation."""
    convo = _get_or_create_conversation(user)
    convo.messages = []
    convo.save(update_fields=["messages", "updated_at"])
    return convo


__all__ = ["chat", "clear_history", "get_history"]
