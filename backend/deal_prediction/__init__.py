"""deal_prediction app — predictive deal-value + close-probability (Phase 18).

Computes ``expected_value = amount * stage.probability`` and
``close_probability = stage.probability`` for every open Deal. The
``get_at_risk`` service compares week-over-week probability drops to
flag deals at risk of slipping. Re-predicted nightly by the
``deal-predict-all`` Celery beat entry (daily 2:30am).
"""
