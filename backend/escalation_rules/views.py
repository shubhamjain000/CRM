"""View module — re-exports the viewsets for backwards compatibility."""

from __future__ import annotations

from escalation_rules.viewsets import (
    EscalationLogViewSet,
    EscalationRuleViewSet,
)

__all__ = ["EscalationLogViewSet", "EscalationRuleViewSet"]
