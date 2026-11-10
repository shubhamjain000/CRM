"""Forecasting app — rep/manager forecasts with submission + approval workflow.

Phase 16 delivers the canonical Salesforce-style forecasting surface on
top of the Phase-8 pipeline:

* :class:`Forecast` — a single user × period × forecast-category bucket.
  ``amount`` is auto-calculated from open deals via
  :func:`forecasting.services.calculate_forecast`; ``override_amount``
  lets the rep / manager manually adjust.
* :class:`ForecastAdjustment` — append-only audit of every manual
  override (old_amount / new_amount / reason / adjusted_by).
"""
