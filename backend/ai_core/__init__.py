"""ai_core app — central AI orchestrator (Phase 18).

Provides the single choke-point through which every other AI app calls an
LLM provider. Wraps OpenAI / Anthropic / Gemini behind a uniform
:func:`ai_core.services.call_llm` surface, logs token usage + cost to
:class:`AICostLog`, and exposes :func:`check_budget` for tenant quota
enforcement. :class:`PromptTemplate` lets admins version + activate
prompt-system + user-prompt-template pairs that downstream services pass
to :func:`call_llm`.
"""
