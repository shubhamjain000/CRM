"""lead_scoring app — predictive lead scoring (Phase 18).

Computes a 0-100 score per lead from CRM-recorded fields (email,
phone, company, annual_revenue, source) plus optional LLM enrichment
via :mod:`ai_core`. Re-scored nightly by the
``lead-scores-all`` Celery beat entry (daily 2am).
"""
