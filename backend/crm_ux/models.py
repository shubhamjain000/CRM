"""UX-layer models for the CRM.

All models inherit :class:`api.models.TenantModel` (tenant FK + ``created_at``
/ ``updated_at``) and are scoped by :class:`api.managers.TenantManager`.

Models
------

* :class:`SavedView` — user-persisted list views (filters / sort / columns /
  groupBy) per CRM module. Sharable within the tenant.
* :class:`RecentlyViewed` — auto-upserted "last viewed" pointer per
  (user, module, record_id). Powers the "Recently viewed" rail.
* :class:`Activity` — append-only timeline events. Created by signal handlers
  on Lead/Contact/Account/Deal writes and by explicit service calls
  (note_added, file_attached, emailed, called, meeting).
* :class:`Note` — record-attached note with @mentions and #hashtags parsed
  out of the body.
* :class:`FileAttachment` — S3-backed file attached to a CRM record.
* :class:`RecordLock` — cooperative pessimistic lock with a 4-hour TTL.
"""

from __future__ import annotations

from datetime import timedelta

from django.db import models
from django.utils import timezone

from api.models import Organization, TenantModel, User

MODULE_CHOICES = [
    ("lead", "Lead"),
    ("contact", "Contact"),
    ("account", "Account"),
    ("deal", "Deal"),
]

#: Cooperative record-lock TTL — locks auto-expire after this duration.
RECORD_LOCK_TTL = timedelta(hours=4)


class SavedView(TenantModel):
    """A user-persisted list configuration for a CRM module.

    The ``config`` JSONField is expected to look like::

        {
          "filters":   [{"field": "lead_status", "op": "eq", "value": "new"}],
          "sort":      [{"field": "created_at", "dir": "desc"}],
          "columns":   ["first_name", "company", "lead_status"],
          "groupBy":   null
        }

    A user can mark at most one of their own views per module as
    ``is_default``; the viewset enforces this on ``set_default``.
    """

    tenant = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name="saved_views",
        db_index=True,
    )
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="saved_views")
    module = models.CharField(max_length=16, choices=MODULE_CHOICES, db_index=True)
    name = models.CharField(max_length=255)
    is_shared = models.BooleanField(default=False, db_index=True)
    config = models.JSONField(default=dict, blank=True)
    is_default = models.BooleanField(default=False)

    class Meta:
        db_table = "crm_ux_saved_view"
        verbose_name = "saved view"
        verbose_name_plural = "saved views"
        ordering = ["module", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "user", "name"],
                name="savedview_unique_name_per_user",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "user", "module"], name="sv_user_module_idx"),
            models.Index(fields=["tenant", "module", "is_shared"], name="sv_module_shared_idx"),
        ]

    def __str__(self) -> str:
        scope = "shared" if self.is_shared else "private"
        return f"{self.name} ({self.module}, {scope})"


class RecentlyViewed(TenantModel):
    """An auto-upserted "last viewed" pointer.

    The :func:`crm_ux.services.track_view` service (and the
    :class:`crm_ux.viewsets.RecentlyViewedViewSet` create endpoint) upserts on
    (tenant, user, module, record_id) — only the latest ``viewed_at`` survives.
    """

    tenant = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name="recently_viewed",
        db_index=True,
    )
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="recently_viewed")
    module = models.CharField(max_length=16, choices=MODULE_CHOICES, db_index=True)
    record_id = models.CharField(max_length=64, db_index=True)
    viewed_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        db_table = "crm_ux_recently_viewed"
        verbose_name = "recently viewed"
        verbose_name_plural = "recently viewed"
        ordering = ["-viewed_at"]
        indexes = [
            models.Index(fields=["tenant", "user", "-viewed_at"], name="rv_user_viewed_idx"),
            models.Index(
                fields=["tenant", "user", "module", "-viewed_at"],
                name="rv_user_module_viewed_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user.email} viewed {self.module}:{self.record_id} @ {self.viewed_at:%Y-%m-%d %H:%M}"


class Activity(TenantModel):
    """An append-only timeline event for a CRM record.

    Written by:

    * signal handlers on Lead/Contact/Account/Deal (created / updated / deleted),
    * :func:`crm_ux.services.log_activity` (note_added / file_attached /
      emailed / called / meeting / converted),
    * :func:`crm_ux.viewsets.NoteViewSet.create` (note_added),
    * :func:`crm_ux.viewsets.FileAttachmentViewSet.create` (file_attached).
    """

    ACTION_CREATED = "created"
    ACTION_UPDATED = "updated"
    ACTION_DELETED = "deleted"
    ACTION_RESTORED = "restored"
    ACTION_CONVERTED = "converted"
    ACTION_NOTE_ADDED = "note_added"
    ACTION_FILE_ATTACHED = "file_attached"
    ACTION_EMAILED = "emailed"
    ACTION_CALLED = "called"
    ACTION_MEETING = "meeting"
    ACTION_CHOICES = [
        (ACTION_CREATED, "Created"),
        (ACTION_UPDATED, "Updated"),
        (ACTION_DELETED, "Deleted"),
        (ACTION_RESTORED, "Restored"),
        (ACTION_CONVERTED, "Converted"),
        (ACTION_NOTE_ADDED, "Note Added"),
        (ACTION_FILE_ATTACHED, "File Attached"),
        (ACTION_EMAILED, "Emailed"),
        (ACTION_CALLED, "Called"),
        (ACTION_MEETING, "Meeting"),
    ]

    tenant = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name="activities",
        db_index=True,
    )
    # ``user`` is nullable so system-initiated events (Celery tasks, signals
    # without request context) can still write rows.
    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="activities",
    )
    module = models.CharField(max_length=16, choices=MODULE_CHOICES, db_index=True)
    record_id = models.CharField(max_length=64, db_index=True)
    record_name = models.CharField(max_length=255, blank=True, default="")
    action = models.CharField(max_length=32, choices=ACTION_CHOICES, db_index=True)
    description = models.TextField(blank=True, default="")
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "crm_ux_activity"
        verbose_name = "activity"
        verbose_name_plural = "activities"
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["tenant", "module", "record_id", "-created_at"],
                name="act_record_created_idx",
            ),
            models.Index(fields=["tenant", "user", "-created_at"], name="act_user_created_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.action} {self.module}:{self.record_id} @ {self.created_at:%Y-%m-%d %H:%M}"


class Note(TenantModel):
    """A note attached to a CRM record.

    The ``body`` may contain ``@<email_or_id>`` mentions and ``#hashtag`` tags.
    These are parsed by :func:`crm_ux.services.parse_mentions_and_hashtags`
    on create / update and stored denormalized in ``mentions`` (list of user
    IDs) and ``hashtags`` (list of tags) for fast querying.
    """

    tenant = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name="notes",
        db_index=True,
    )
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="notes")
    module = models.CharField(max_length=16, choices=MODULE_CHOICES, db_index=True)
    record_id = models.CharField(max_length=64, db_index=True)
    body = models.TextField()
    mentions = models.JSONField(default=list, blank=True)
    hashtags = models.JSONField(default=list, blank=True)

    class Meta:
        db_table = "crm_ux_note"
        verbose_name = "note"
        verbose_name_plural = "notes"
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["tenant", "module", "record_id", "-created_at"],
                name="note_record_created_idx",
            ),
        ]

    def __str__(self) -> str:
        preview = (self.body or "")[:60].replace("\n", " ")
        return f"Note on {self.module}:{self.record_id}: {preview!r}"


class FileAttachment(TenantModel):
    """A file uploaded against a CRM record, stored in S3 / MinIO.

    The actual upload is handled by :func:`crm_ux.viewsets.FileAttachmentViewSet.create`
    via Django's default storage (``storages.backends.s3.S3Storage`` in prod /
    MinIO in dev). The ``s3_key`` is the storage-side path; ``file_url`` is the
    pre-signed or public URL.
    """

    tenant = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name="file_attachments",
        db_index=True,
    )
    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="file_attachments",
    )
    module = models.CharField(max_length=16, choices=MODULE_CHOICES, db_index=True)
    record_id = models.CharField(max_length=64, db_index=True)
    filename = models.CharField(max_length=255)
    file_url = models.URLField(max_length=1024, blank=True, default="")
    file_size = models.BigIntegerField(default=0)
    mime_type = models.CharField(max_length=255, blank=True, default="")
    s3_key = models.CharField(max_length=512, blank=True, default="")

    class Meta:
        db_table = "crm_ux_file_attachment"
        verbose_name = "file attachment"
        verbose_name_plural = "file attachments"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "module", "record_id"], name="file_record_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.filename} ({self.mime_type or 'unknown'}) on {self.module}:{self.record_id}"


class RecordLock(TenantModel):
    """A cooperative pessimistic lock on a CRM record.

    Locks auto-expire after :data:`RECORD_LOCK_TTL` (4 hours). The
    :class:`crm_ux.viewsets.RecordLockViewSet` purges expired locks on every
    list call, so an expired lock is effectively a no-op.

    Uniqueness: at most one (tenant, module, record_id) row may exist.
    """

    tenant = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name="record_locks",
        db_index=True,
    )
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="record_locks")
    module = models.CharField(max_length=16, choices=MODULE_CHOICES, db_index=True)
    record_id = models.CharField(max_length=64, db_index=True)
    locked_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()

    class Meta:
        db_table = "crm_ux_record_lock"
        verbose_name = "record lock"
        verbose_name_plural = "record locks"
        ordering = ["-locked_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "module", "record_id"],
                name="recordlock_unique_per_record",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "module", "record_id"], name="rlock_record_idx"),
            models.Index(fields=["tenant", "expires_at"], name="rlock_expires_idx"),
        ]

    def __str__(self) -> str:
        return f"Lock {self.module}:{self.record_id} by {self.user.email} until {self.expires_at:%H:%M}"

    def save(self, *args: object, **kwargs: object) -> None:  # type: ignore[override]
        if not self.expires_at:
            base = self.locked_at or timezone.now()
            self.expires_at = base + RECORD_LOCK_TTL
        super().save(*args, **kwargs)

    @property
    def is_expired(self) -> bool:
        """Return ``True`` if the lock's TTL has elapsed."""
        return self.expires_at is not None and timezone.now() >= self.expires_at
