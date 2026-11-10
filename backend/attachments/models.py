"""Attachment model — polymorphic join between a CRM record and a File.

Design notes
------------
* :class:`Attachment` inherits :class:`api.models.TenantModel` (tenant FK
  + ``created_at`` / ``updated_at``) but is *not* soft-deletable —
  detaching a file is a hard delete (the underlying :class:`File` row is
  soft-deletable separately).
* ``record_module`` is a free-form char (validated by the viewset to one
  of the known CRM modules) and ``record_id`` is a string to accommodate
  UUIDs as well as integer PKs. This is the same pattern used by
  :class:`crm_ux.models.Activity` and :class:`tasks.models.Task.related_*`.
* ``file`` is a FK to :class:`files.models.File` with
  ``on_delete=CASCADE`` — deleting the file removes the attachment.
* Uniqueness on ``(record_module, record_id, file)`` prevents duplicate
  attachments of the same file to the same record.
* ``is_inline`` flags attachments embedded in a note/email body (used by
  the renderer to suppress them from the "Attachments" list).
"""

from __future__ import annotations

from django.db import models

from api.models import TenantModel, User
from files.models import File


class Attachment(TenantModel):
    """A polymorphic link between a CRM record and a :class:`File`."""

    RECORD_LEAD = "lead"
    RECORD_CONTACT = "contact"
    RECORD_ACCOUNT = "account"
    RECORD_DEAL = "deal"
    RECORD_TASK = "task"
    RECORD_EVENT = "event"
    RECORD_NOTE = "note"
    RECORD_MODULE_CHOICES = [
        (RECORD_LEAD, "Lead"),
        (RECORD_CONTACT, "Contact"),
        (RECORD_ACCOUNT, "Account"),
        (RECORD_DEAL, "Deal"),
        (RECORD_TASK, "Task"),
        (RECORD_EVENT, "Event"),
        (RECORD_NOTE, "Note"),
    ]

    record_module = models.CharField(
        max_length=16,
        choices=RECORD_MODULE_CHOICES,
        db_index=True,
    )
    record_id = models.CharField(max_length=64, db_index=True)
    file = models.ForeignKey(
        File,
        on_delete=models.CASCADE,
        related_name="attachments",
        db_index=True,
    )
    attached_by = models.ForeignKey(
        User,
        on_delete=models.RESTRICT,
        related_name="attachments_created",
    )
    description = models.TextField(blank=True, default="")
    is_inline = models.BooleanField(
        default=False,
        db_index=True,
        help_text="True when the file is embedded in a note/email body (suppressed from the attachments list).",
    )

    class Meta:
        db_table = "attachments_attachment"
        verbose_name = "attachment"
        verbose_name_plural = "attachments"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["record_module", "record_id", "file"],
                name="attachment_unique_per_record_file",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    record_module__in=(
                        "lead",
                        "contact",
                        "account",
                        "deal",
                        "task",
                        "event",
                        "note",
                    )
                ),
                name="attachment_record_module_valid",
            ),
        ]
        indexes = [
            models.Index(
                fields=["tenant", "record_module", "record_id"],
                name="attach_record_idx",
            ),
            models.Index(fields=["tenant", "file"], name="attach_file_idx"),
            models.Index(fields=["tenant", "is_inline"], name="attach_inline_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.file.name} → {self.record_module}:{self.record_id}"
