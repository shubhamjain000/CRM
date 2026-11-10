"""Service helpers for the feed app.

Keeps mention / hashtag parsing, reaction-count aggregation, and the
post-comment-list shape in one place so the viewsets + serializers stay thin
and the logic is unit-testable without an HTTP layer.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover — typing only
    from api.models import Organization


#: Matches ``@<email>`` or ``@<numeric_user_id>`` tokens.
_MENTION_RE = re.compile(r"@(?P<token>[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\d+)")
#: Matches ``#hashtag`` tokens (letters, digits, underscore, hyphen).
_HASHTAG_RE = re.compile(r"#(?P<tag>[A-Za-z0-9_-]+)")


def parse_mentions_and_hashtags(
    text: str,
    *,
    tenant: "Organization | None" = None,
) -> dict[str, list[Any]]:
    """Extract ``@mentions`` and ``#hashtags`` from ``text``.

    Mirrors :func:`crm_ux.services.parse_mentions_and_hashtags` so feed posts
    share the same mention syntax as CRM notes.

    * Numeric ``@123`` tokens are kept as integers (assumed to be user IDs).
    * ``@email`` tokens are resolved to user IDs via :class:`TenantMembership`
      when ``tenant`` is provided; unresolved emails are dropped.
    * Hashtags are lowercased, de-duplicated, and sorted.
    """
    if not text:
        return {"mentions": [], "hashtags": []}

    raw_mentions = _MENTION_RE.findall(text)
    hashtags = sorted({tag.lower() for tag in _HASHTAG_RE.findall(text)})

    mentions: list[Any] = []
    for token in raw_mentions:
        if token.isdigit():
            mentions.append(int(token))
        elif tenant is not None:
            user_id = _resolve_user_id_by_email(token, tenant)
            if user_id is not None:
                mentions.append(user_id)

    seen: set[Any] = set()
    deduped: list[Any] = []
    for value in mentions:
        if value not in seen:
            seen.add(value)
            deduped.append(value)
    return {"mentions": deduped, "hashtags": hashtags}


def _resolve_user_id_by_email(email: str, tenant: "Organization") -> int | None:
    """Resolve ``email`` to a user ID active in ``tenant`` (case-insensitive)."""
    from api.models import User

    return (
        User.objects.filter(
            email__iexact=email,
            memberships__tenant=tenant,
            memberships__is_active=True,
        )
        .values_list("pk", flat=True)
        .first()
    )


def reaction_counts(reactions: Any) -> list[dict[str, Any]]:
    """Aggregate an iterable of :class:`feed.models.FeedReaction` into a sorted list.

    Each item is ``{"emoji": "👍", "count": 3, "user_ids": [1, 2, 3]}`` sorted by
    count desc (then emoji asc) for stable UI rendering.
    """
    bucket: dict[str, list[int]] = {}
    for reaction in reactions:
        bucket.setdefault(reaction.emoji, []).append(reaction.user_id)
    out = [
        {"emoji": emoji, "count": len(uids), "user_ids": sorted(uids)}
        for emoji, uids in bucket.items()
    ]
    out.sort(key=lambda item: (-item["count"], item["emoji"]))
    return out
