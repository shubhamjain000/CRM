"""smart_suggestions app — next-best-action cards (Phase 18).

Generates short-lived actionable suggestion cards for each user:
leads-not-contacted-in-7-days, deals-stuck-in-stage,
missing-decision-makers, etc. The user can ``accept`` (mark acted-on)
or ``dismiss`` (mark hidden). Re-generated on demand via the
``/generate/`` endpoint.
"""
