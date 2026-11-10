"""ai_agents app — autonomous AI agent runs (Phase 18).

Five agent types — lead_research, deal_coach, email_triage,
data_hygiene, customer_success — each runs as a Celery task triggered
by CRM signals (new lead → lead_research; deal update → deal_coach;
email received → email_triage). Each run is recorded as an
:class:`AIAgentRun` row with ``status`` ∈ {running, completed, failed}
and a ``result`` JSON field.
"""
