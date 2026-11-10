"""Note + collaboration models.

Design notes
------------
* :class:`Note` inherits :class:`api.soft_delete.SoftDeleteTenantModel` →
  tenant FK (``CASCADE``), ``created_at`` / ``updated_at``, ``deleted_at``,
  and the soft-delete-aware ``objects`` / ``all_objects`` managers.
* ``body`` is a free-form text column. ``body_type`` declares its format
  (``html`` / ``yjs`` / ``markdown``) so the frontend knows how to render.
  For Yjs we store the JSON-encoded doc state; for HTML/Markdown we store
  the rendered text.
* ``shared_with`` is an M2M through :class:`NoteShare` carrying per-user
  permission levels (read / edit / admin). Author always implicitly has
  admin and bypasses the through-model lookup.
* ``mentions`` / ``hashtags`` / ``tags`` are denormalized JSON lists parsed
  out of ``body`` by :mod:`notes.signals` on every save.
* ``edit_history`` is a JSON list of ``{user_id, timestamp, snapshot}``
  entries — a lightweight alternative to :class:`NoteVersion` for very
  small snapshots (e.g. cursor moves). The full-body snapshots live in
  :class:`NoteVersion`.
* :class:`NoteComment` supports inline commentary via ``selected_text`` —
  the user-highlighted excerpt the comment is anchored to. ``resolved``
  lets the team mark comment threads as done.
* :class:`NoteVersion` is created on every ``post_save`` update (the signal
  filters out saves triggered by ``update_fields=['deleted_at', ...]`` so
  soft-delete / restore don't create spurious versions). Versions are
  numbered per-note via :meth:`Note.next_version_number`.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import User
from api.soft_delete import SoftDeleteTenantModel


class Note(SoftDeleteTenantModel):
    """A collaborative rich-text note with mentions, hashtags, and sharing."""

    BODY_HTML = "html"
    BODY_YJS = "yjs"
    BODY_MARKDOWN = "markdown"
    BODY_TYPE_CHOICES = [
        (BODY_HTML, "HTML"),
        (BODY_YJS, "Yjs document JSON"),
        (BODY_MARKDOWN, "Markdown"),
    ]

    title = models.CharField(max_length=255, blank=True, default="")
    body = models.TextField(blank=True, default="")
    body_type = models.CharField(
        max_length=16,
        choices=BODY_TYPE_CHOICES,
        default=BODY_HTML,
        db_index=True,
    )
    is_pinned = models.BooleanField(default=False, db_index=True)
    is_private = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Private notes are only visible to the author.",
    )
    author = models.ForeignKey(
        User,
        on_delete=models.RESTRICT,
        related_name="authored_notes",
        db_index=True,
    )
    last_edited_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="last_edited_notes",
    )
    related_module = models.CharField(
        max_length=32,
        blank=True,
        default="",
        db_index=True,
        help_text="CRM module this note relates to (lead/contact/account/deal/task/event).",
    )
    related_id = models.CharField(
        max_length=64,
        blank=True,
        default="",
        db_index=True,
    )
    mentions = models.JSONField(
        default=list,
        blank=True,
        help_text="List of user IDs extracted from @mentions in the body.",
    )
    hashtags = models.JSONField(
        default=list,
        blank=True,
        help_text="List of #hashtags extracted from the body (lowercased, de-duped).",
    )
    tags = models.JSONField(
        default=list,
        blank=True,
        help_text="Free-form tags assigned by the author.",
    )
    shared_with = models.ManyToManyField(
        User,
        through="NoteShare",
        related_name="shared_notes",
        blank=True,
    )
    edit_history = models.JSONField(
        default=list,
        blank=True,
        help_text="Lightweight edit trail: list of {user_id, timestamp, snapshot} entries.",
    )

    class Meta:
        db_table = "notes_note"
        verbose_name = "note"
        verbose_name_plural = "notes"
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(body_type__in=("html", "yjs", "markdown")),
                name="notes_body_type_valid",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "deleted_at"], name="notes_tenant_deleted_idx"),
            models.Index(fields=["tenant", "author", "-created_at"], name="notes_author_created_idx"),
            models.Index(
                fields=["tenant", "related_module", "related_id"],
                name="notes_related_idx",
            ),
            models.Index(fields=["tenant", "is_pinned"], name="notes_pinned_idx"),
            models.Index(fields=["tenant", "is_private"], name="notes_private_idx"),
        ]

    def __str__(self) -> str:
        return self.title or f"Note #{self.pk}"

    # ------------------------------------------------------------------ helpers

    def next_version_number(self) -> int:
        """Return the next version number for this note (1-based, gap-free)."""
        last = (
            NoteVersion.all_objects.filter(note_id=self.pk).order_by("-version_number").first()
        )
        return (last.version_number + 1) if last else 1

    def append_edit_history(self, *, user_id: int | None, snapshot: str) -> None:
        """Append an entry to ``edit_history`` and persist (cap at 100 entries)."""
        history = list(self.edit_history or [])
        history.append(
            {
                "user_id": user_id,
                "timestamp": timezone.now().isoformat(),
                "snapshot": snapshot[:500],  # truncate to keep the column lean
            }
        )
        # Cap to the most recent 100 entries.
        if len(history) > 100:
            history = history[-100:]
        self.edit_history = history
        self.save(update_fields=["edit_history", "updated_at"])


class NoteShare(models.Model):
    """Through model for ``Note.shared_with`` — per-user permission level."""

    PERMISSION_READ = "read"
    PERMISSION_EDIT = "edit"
    PERMISSION_ADMIN = "admin"
    PERMISSION_CHOICES = [
        (PERMISSION_READ, "Read"),
        (PERMISSION_EDIT, "Edit"),
        (PERMISSION_ADMIN, "Admin"),
    ]

    note = models.ForeignKey(
        Note,
        on_delete=models.CASCADE,
        related_name="shares",
        db_index=True,
    )
    user = models.ForeignKey(
        User,
        on_delete=models.RESTRICT,
        related_name="note_shares",
        db_index=True,
    )
    permission = models.CharField(
        max_length=8,
        choices=PERMISSION_CHOICES,
        default=PERMISSION_READ,
    )
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "notes_share"
        verbose_name = "note share"
        verbose_name_plural = "note shares"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["note", "user"],
                name="noteshare_unique_per_note_user",
            ),
            models.CheckConstraint(
                condition=models.Q(permission__in=("read", "edit", "admin")),
                name="noteshare_permission_valid",
            ),
        ]
        indexes = [
            models.Index(fields=["user", "permission"], name="noteshare_user_perm_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.user.email} → {self.note} ({self.permission})"


class NoteComment(models.Model):
    """A comment on a note — optionally anchored to a body excerpt."""

    note = models.ForeignKey(
        Note,
        on_delete=models.CASCADE,
        related_name="comments",
        db_index=True,
    )
    user = models.ForeignKey(
        User,
        on_delete=models.RESTRICT,
        related_name="note_comments",
    )
    selected_text = models.TextField(
        blank=True,
        default="",
        help_text="The body excerpt this comment is anchored to (empty for general comments).",
    )
    body = models.TextField()
    resolved = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "notes_comment"
        verbose_name = "note comment"
        verbose_name_plural = "note comments"
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["note", "-created_at"], name="notecomment_note_created_idx"),
            models.Index(fields=["note", "resolved"], name="notecomment_note_resolved_idx"),
        ]

    def __str__(self) -> str:
        preview = (self.body or "")[:60].replace("\n", " ")
        return f"Comment by {self.user.email} on {self.note}: {preview!r}"


class NoteVersion(models.Model):
    """An immutable body snapshot — used for version history + restore."""

    note = models.ForeignKey(
        Note,
        on_delete=models.CASCADE,
        related_name="versions",
        db_index=True,
    )
    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="note_versions",
    )
    body = models.TextField()
    version_number = models.PositiveIntegerField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "notes_version"
        verbose_name = "note version"
        verbose_name_plural = "note versions"
        ordering = ["-version_number"]
        constraints = [
            models.UniqueConstraint(
                fields=["note", "version_number"],
                name="noteversion_unique_per_note_number",
            ),
        ]
        indexes = [
            models.Index(fields=["note", "version_number"], name="noteversion_note_num_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.note} v{self.version_number}"
