"""Service layer for the ai_writer app.

Three generators, all backed by :func:`ai_core.services.call_llm` with
``task_type=TASK_EMAIL_DRAFT``. Each returns the persisted
:class:`AIWriterDraft` row.

* :func:`generate_email` — drafts an email body from a user prompt with
  a style + tone.
* :func:`generate_summary` — bullet-point summary of a longer text.
* :func:`generate_subject_lines` — 3-5 subject-line candidates.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from .models import AIWriterDraft, DRAFT_EMAIL, DRAFT_SUMMARY

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization, User

log = logging.getLogger(__name__)


def _call(prompt: str, system: str, *, tenant: "Organization | None") -> str:
    from ai_core.services import call_llm  # noqa: PLC0415

    response = call_llm(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        model="gpt-4o-mini",
        task_type="email_draft",
        tenant=tenant,
    )
    return response["content"]


def generate_email(
    prompt: str,
    *,
    style: str = "professional",
    tone: str = "friendly",
    user: "User | None" = None,
    tenant: "Organization | None" = None,
) -> AIWriterDraft:
    """Draft an email body from ``prompt`` with ``style`` + ``tone``."""
    from api.managers import get_current_tenant  # noqa: PLC0415

    if tenant is None:
        tenant = get_current_tenant()
    system = (
        f"You are an email-writing assistant. Style: {style}. Tone: {tone}. "
        "Produce a complete email body (subject line + greeting + body + sign-off)."
    )
    content = _call(prompt, system, tenant=tenant)
    return AIWriterDraft.objects.create(
        tenant=tenant,
        user=user,
        draft_type=DRAFT_EMAIL,
        prompt=prompt,
        generated_content=content,
        style=style,
        tone=tone,
    )


def generate_summary(
    text: str,
    *,
    user: "User | None" = None,
    tenant: "Organization | None" = None,
) -> AIWriterDraft:
    """Summarize ``text`` into 3-5 bullet points."""
    from api.managers import get_current_tenant  # noqa: PLC0415

    if tenant is None:
        tenant = get_current_tenant()
    system = (
        "You are a summarization assistant. Produce 3-5 bullet points "
        "capturing the key takeaways of the user's text."
    )
    content = _call(text, system, tenant=tenant)
    return AIWriterDraft.objects.create(
        tenant=tenant,
        user=user,
        draft_type=DRAFT_SUMMARY,
        prompt=text,
        generated_content=content,
    )


def generate_subject_lines(
    email_body: str,
    *,
    user: "User | None" = None,
    tenant: "Organization | None" = None,
) -> list[str]:
    """Return 3-5 subject-line candidates for ``email_body``.

    Does not persist a draft (it's a quick suggestion list).
    """
    from ai_core.services import call_llm  # noqa: PLC0415

    if tenant is None:
        from api.managers import get_current_tenant  # noqa: PLC0415

        tenant = get_current_tenant()
    response = call_llm(
        [
            {
                "role": "system",
                "content": "You suggest 3-5 short email subject lines (one per line).",
            },
            {"role": "user", "content": email_body},
        ],
        model="gpt-4o-mini",
        task_type="email_draft",
        tenant=tenant,
    )
    lines = [
        line.strip(" -*\t")
        for line in response["content"].splitlines()
        if line.strip()
    ]
    return lines[:5]


__all__ = ["generate_email", "generate_subject_lines", "generate_summary"]
