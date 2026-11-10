"""Validation-rules app — runtime field validators for CRM records.

Phase 10 introduces the rule-engine layer. The ``validation_rules`` app
adds a tenant-scoped :class:`ValidationRule` model + a service layer that
runs the rules on every ``pre_save`` of Lead / Contact / Account / Deal.
A rule with ``error_severity=error`` raises ``ValidationError`` and
blocks the save; ``warning`` is logged but does not block.
"""
