"""Assignment-rules app — auto-assign records to users based on criteria.

Phase 10 introduces the rule-engine layer. The ``assignment_rules`` app
adds a tenant-scoped :class:`AssignmentRule` model + a service layer that
evaluates the rules on every ``post_save(created=True)`` of Lead /
Contact / Account / Deal. The first matching rule's strategy is executed
(round-robin / lead-balance / territory / custom) and the record's
``owner`` is updated.
"""
