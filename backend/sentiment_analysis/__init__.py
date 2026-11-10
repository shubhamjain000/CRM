"""sentiment_analysis app — text-sentiment scoring (Phase 18).

Lightweight heuristic analyzer: counts positive vs negative word
matches against small fixed lexicons, returns a sentiment in [-1, +1]
with a confidence score. Heavier LLM-based analysis is wired through
:func:`ai_core.services.call_llm` with ``task_type=TASK_SENTIMENT``.
"""
