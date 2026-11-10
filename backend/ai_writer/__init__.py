"""ai_writer app — LLM-backed content drafts (Phase 18).

Generates email / blog / social / summary / proposal drafts through
:func:`ai_core.services.call_llm` with ``task_type=TASK_EMAIL_DRAFT``.
Each generated draft is persisted as an :class:`AIWriterDraft` row so
the user can review, regenerate, or copy it into the target module.
"""
