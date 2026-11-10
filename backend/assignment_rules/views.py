"""View module — re-exports the viewsets for backwards compatibility."""

from __future__ import annotations

from assignment_rules.viewsets import (
    AssignmentHistoryViewSet,
    AssignmentRuleViewSet,
)

__all__ = ["AssignmentHistoryViewSet", "AssignmentRuleViewSet"]
