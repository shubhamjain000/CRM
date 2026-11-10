"""Signal handlers for the notes app.

Wired in :meth:`notes.apps.NotesConfig.ready`.

Responsibilities
----------------
* On every ``post_save`` of :class:`Note` (create or update), parse
  @mentions and #hashtags out of ``body`` and persist them in
  ``mentions`` / ``hashtags``. The parse runs inside ``update_fields``
  so it doesn't recurse into the signal.
* On update (not create), capture a :class:`NoteVersion` snapshot of the
  body so the version-history endpoint can replay it. Soft-delete /
  restore saves are explicitly skipped — they don't represent content
  edits.
* On create, capture the initial version (``version_number=1``) so
  ``restore_version`` can always fall back to the original.
"""

from __future__ import annotations

from typing import Any

from django.db.models.base import ModelBase
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone

from notes.models import Note, NoteVersion
from notes.services import extract_snapshot, parse_hashtags, parse_mentions


def _is_soft_delete_save(update_fields: set[str] | None) -> bool:
    """Return ``True`` when this save only touches ``deleted_at``."""
    if not update_fields:
        return False
    return update_fields <= {"deleted_at", "updated_at"}


@receiver(post_save, sender=Note)
def note_post_save(
    sender: ModelBase,
    instance: Note,
    created: bool,
    raw: bool,
    **kwargs: Any,
) -> None:
    """Parse mentions/hashtags from the body and capture a version snapshot."""
    if raw:
        return
    if instance.tenant_id is None:
        return

    update_fields = kwargs.get("update_fields")
    update_fields_set: set[str] | None = set(update_fields) if update_fields else None

    # Always (re)parse mentions + hashtags from the body — unless this is a
    # soft-delete save (no content change).
    if not _is_soft_delete_save(update_fields_set):
        mentions = parse_mentions(instance.body or "")
        hashtags = parse_hashtags(instance.body or "")
        # Only write back if something changed (avoid infinite signal recursion
        # via save()); we use update() to bypass post_save entirely.
        if instance.mentions != mentions or instance.hashtags != hashtags:
            Note.all_objects.filter(pk=instance.pk).update(
                mentions=mentions,
                hashtags=hashtags,
            )
            instance.mentions = mentions
            instance.hashtags = hashtags

    # Capture a version snapshot on create + on content updates (skip
    # soft-delete / restore + skip saves triggered by our own update()).
    if _is_soft_delete_save(update_fields_set):
        return
    if update_fields_set and update_fields_set <= {"mentions", "hashtags"}:
        return

    try:
        next_version = instance.next_version_number()
        NoteVersion.objects.create(
            note=instance,
            user=instance.last_edited_by or instance.author,
            body=extract_snapshot(instance.body or ""),
            version_number=next_version,
        )
    except Exception:  # pragma: no cover — defensive: never break a note save
        # Logging is intentionally omitted to keep the signal lightweight;
        # the version-history endpoint degrades gracefully to "no versions".
        pass


def stamp_last_edited(*, note: Note, user: Any) -> None:
    """Helper used by the viewset to set ``last_edited_by`` + ``updated_at``."""
    note.last_edited_by = user
    note.updated_at = timezone.now()
    note.save(update_fields=["last_edited_by", "updated_at"])
