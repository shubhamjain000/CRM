"""Attachments app — polymorphic join between any CRM record and a File.

Provides:

* :class:`attachments.models.Attachment` — a tenant-scoped polymorphic
  link between a CRM record (lead/contact/account/deal/task/event/note)
  identified by ``record_module`` + ``record_id`` and a
  :class:`files.models.File`. Enforces uniqueness of
  (record_module, record_id, file) so the same file can't be attached to
  the same record twice.

Endpoints mount under ``/api/v1/attachments/``.
"""
