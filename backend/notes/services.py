"""Service layer for the notes app.

Pure-Python helpers used by the viewset and signals. Kept side-effect-free
where possible (no DB writes) so they're easy to unit-test.

* :func:`parse_mentions` — extract @<user-id> tokens from a note body.
* :func:`parse_hashtags` — extract #hashtag tokens from a note body.
* :func:`extract_snapshot` — strip metadata from a body for version storage.
"""

from __future__ import annotations

import re

#: ``@<digits>`` (numeric user IDs). Example: ``@42``.
_MENTION_RE = re.compile(r"@(?P<uid>\d+)\b")

#: ``#<word>`` (alphanumeric + dashes). Example: ``#phase-6``.
_HASHTAG_RE = re.compile(r"#(?P<tag>[A-Za-z0-9][A-Za-z0-9_-]*)")

#: Maximum characters preserved in a version-snapshot preview.
SNAPSHOT_PREVIEW_MAX = 500


def parse_mentions(body: str) -> list[int]:
    """Return the list of integer user IDs mentioned in ``body`` (de-duped, ordered)."""
    if not body:
        return []
    seen: set[int] = set()
    out: list[int] = []
    for match in _MENTION_RE.finditer(body):
        try:
            uid = int(match.group("uid"))
        except ValueError:  # pragma: no cover — regex guarantees digits
            continue
        if uid not in seen:
            seen.add(uid)
            out.append(uid)
    return out


def parse_hashtags(body: str) -> list[str]:
    """Return the list of #hashtags in ``body`` (lowercased, de-duped, ordered)."""
    if not body:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for match in _HASHTAG_RE.finditer(body):
        tag = match.group("tag").lower()
        if tag and tag not in seen:
            seen.add(tag)
            out.append(tag)
    return out


def extract_snapshot(body: str) -> str:
    """Return a body snapshot suitable for :class:`notes.models.NoteVersion`.

    Currently a passthrough; kept as a function so future compression /
    sanitization logic has a single home.
    """
    return body or ""
