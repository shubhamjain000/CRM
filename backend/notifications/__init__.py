"""Notifications app — in-app, email, push, and SMS notification dispatch.

Provides:

* :class:`notifications.models.Notification` — a tenant-scoped notification row
  addressed to a single recipient (``recipient``), with an ``actor`` (the user
  who triggered it, nullable for system-generated events), a ``verb`` (e.g.
  ``mentioned`` / ``commented`` / ``assigned``), a polymorphic ``target_*``
  triple (module + id + display name), an optional ``channel``
  (in_app|email|push|sms), a free-form ``data`` JSONField, and a ``read_at``
  soft-read timestamp.
* :class:`notifications.models.NotificationPreference` — per (user, type)
  channel toggles + a digest mode (immediate|daily|weekly).
* :class:`notifications.models.QuietHours` — per-user do-not-disturb window.

Endpoints mount under ``/api/v1/`` (``notifications/``, ``notification-preferences/``,
``quiet-hours/``).
"""
