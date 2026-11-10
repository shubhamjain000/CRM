"""Notes app — collaborative rich-text notes for the CRM.

Provides:

* :class:`notes.models.Note` — a tenant-scoped, soft-deletable rich-text note
  (HTML / Yjs JSON / Markdown) with @mentions, #hashtags, sharing, comments,
  and version history.
* :class:`notes.models.NoteShare` — M2M-through model granting per-user
  permissions (read / edit / admin) on a note.
* :class:`notes.models.NoteComment` — inline + general comments on a note,
  with ``selected_text`` for inline commentary and ``resolved`` flag.
* :class:`notes.models.NoteVersion` — snapshot of the note body on every
  save, used by ``restore_version`` and ``version_history``.

Endpoints mount under ``/api/v1/notes/``.
"""
