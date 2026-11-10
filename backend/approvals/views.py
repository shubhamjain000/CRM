"""View module — re-exports the viewsets for backwards compatibility.

The Phase-9+ convention is to keep viewsets in ``viewsets.py`` and have
``views.py`` re-export them so callers can ``from approvals.views import
ApprovalProcessViewSet`` regardless of which module the class lives in.
"""

from __future__ import annotations

from approvals.viewsets import (
    ApprovalDelegationViewSet,
    ApprovalProcessViewSet,
    ApprovalRequestViewSet,
)

__all__ = [
    "ApprovalDelegationViewSet",
    "ApprovalProcessViewSet",
    "ApprovalRequestViewSet",
]
