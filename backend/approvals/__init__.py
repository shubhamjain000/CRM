"""Approvals app — multi-step approval workflow engine.

Phase 10 introduces the rule-engine layer that sits on top of the Phase 8
pipeline + Phase 9 blueprint state machine. The ``approvals`` app is the
canonical home for :class:`approvals.models.ApprovalProcess` (previously a
stub in :mod:`deals.models`) plus the runtime models
(:class:`ApprovalStep`, :class:`ApprovalRequest`, :class:`ApprovalAction`,
:class:`ApprovalDelegation`) and the :class:`approvals.services.ApprovalService`
service layer.
"""
