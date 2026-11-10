"""zia_chatbot app — Zia conversational assistant (Phase 18).

Single-tenant-per-user Zia conversation surface. The system prompt
describes the CRM schema + available tools (function calling) so the
underlying LLM can drive downstream CRM actions through
:func:`ai_core.services.call_llm`. Messages are stored as a JSON list
on :class:`ZiaConversation`.
"""
