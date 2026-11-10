"""Notification models.

Design notes
------------
* All three models inherit :class:`api.models.TenantModel` (tenant FK +
  ``created_at`` / ``updated_at``) and are scoped by
  :class:`api.managers.TenantManager`.
* :class:`Notification` is *not* soft-deletable — recipients mark rows read
  via ``read_at``; an out-of-band retention task purges old read rows. The
  ``archive`` action on the viewset sets ``read_at`` to a sentinel value and
  is treated identically for unread counts.
* :class:`NotificationPreference` is keyed on (tenant, user, notification_type)
  so each user can have at most one preference row per type. Defaults are
  applied via :data:`DEFAULTS` when a row is missing — callers should use
  :func:`notifications.services.get_effective_preference`.
* :class:`QuietHours` is singleton-per-user (unique on (tenant, user)).
"""

from __future__ import annotations

from django.db import models

from api.models import Organization, TenantModel, User


###############################################################################
# Notification
###############################################################################


class Notification(TenantModel):
    """A notification addressed to a single recipient.

    * ``actor`` is the user who triggered the event (nullable for
      system-initiated notifications — e.g. a Celery beat reminder).
    * ``verb`` is a stable string enum — see :data:`VERB_CHOICES`.
    * ``target_module`` / ``target_id`` / ``target_name`` form a polymorphic
      pointer to the affected record. The frontend uses these to deep-link.
    * ``channel`` records how the notification was *delivered* (in_app|email|
      push|sms). In-app rows are always created; email/push/sms rows are
      created by the services layer when those channels fire.
    * ``read_at`` doubles as the archive timestamp. The viewset exposes
      ``mark_read`` and ``archive`` actions; both set ``read_at`` (archive
      also sets a flag in ``data.archived`` so the UI can hide them).
    """

    VERB_MENTIONED = "mentioned"
    VERB_COMMENTED = "commented"
    VERB_LIKED = "liked"
    VERB_SHARED = "shared"
    VERB_ASSIGNED = "assigned"
    VERB_APPROVAL_REQUESTED = "approval_requested"
    VERB_APPROVAL_COMPLETED = "approval_completed"
    VERB_CREATED = "created"
    VERB_UPDATED = "updated"
    VERB_UPLOADED = "uploaded"
    VERB_INVITED = "invited"
    VERB_EMAIL_RECEIVED = "email_received"
    VERB_TASK_DUE = "task_due"
    VERB_EVENT_REMINDER = "event_reminder"
    VERB_CHOICES = [
        (VERB_MENTIONED, "Mentioned"),
        (VERB_COMMENTED, "Commented"),
        (VERB_LIKED, "Liked"),
        (VERB_SHARED, "Shared"),
        (VERB_ASSIGNED, "Assigned"),
        (VERB_APPROVAL_REQUESTED, "Approval requested"),
        (VERB_APPROVAL_COMPLETED, "Approval completed"),
        (VERB_CREATED, "Created"),
        (VERB_UPDATED, "Updated"),
        (VERB_UPLOADED, "Uploaded"),
        (VERB_INVITED, "Invited"),
        (VERB_EMAIL_RECEIVED, "Email received"),
        (VERB_TASK_DUE, "Task due"),
        (VERB_EVENT_REMINDER, "Event reminder"),
    ]

    CHANNEL_IN_APP = "in_app"
    CHANNEL_EMAIL = "email"
    CHANNEL_PUSH = "push"
    CHANNEL_SMS = "sms"
    CHANNEL_CHOICES = [
        (CHANNEL_IN_APP, "In-app"),
        (CHANNEL_EMAIL, "Email"),
        (CHANNEL_PUSH, "Push"),
        (CHANNEL_SMS, "SMS"),
    ]

    tenant = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name="notifications",
        db_index=True,
    )
    actor = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="triggered_notifications",
        db_index=True,
    )
    verb = models.CharField(max_length=32, choices=VERB_CHOICES, db_index=True)
    target_module = models.CharField(max_length=32, blank=True, default="", db_index=True)
    target_id = models.CharField(max_length=64, blank=True, default="", db_index=True)
    target_name = models.CharField(max_length=255, blank=True, default="")
    recipient = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="notifications_received",
        db_index=True,
    )
    read_at = models.DateTimeField(null=True, blank=True, db_index=True)
    channel = models.CharField(
        max_length=16,
        choices=CHANNEL_CHOICES,
        default=CHANNEL_IN_APP,
        db_index=True,
    )
    data = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "notifications_notification"
        verbose_name = "notification"
        verbose_name_plural = "notifications"
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["tenant", "recipient", "read_at"],
                name="notif_recipient_read_idx",
            ),
            models.Index(
                fields=["tenant", "recipient", "-created_at"],
                name="notif_recipient_created_idx",
            ),
            models.Index(fields=["tenant", "-created_at"], name="notif_tenant_created_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.actor_id or 'system'} {self.verb} → {self.recipient_id}"

    @property
    def is_read(self) -> bool:
        """Return ``True`` if the notification has been marked read or archived."""
        return self.read_at is not None


###############################################################################
# NotificationPreference
##############################################################################


class NotificationPreference(TenantModel):
    """Per-user, per-notification-type channel toggles.

    Defaults: in_app = True, email = True, push = False, sms = False,
    digest_mode = ``immediate``. The :func:`notifications.services.should_send`
    helper honors these + :class:`QuietHours` before dispatching.
    """

    TYPE_MENTION = "mention"
    TYPE_COMMENT = "comment"
    TYPE_LIKE = "like"
    TYPE_ASSIGNMENT = "assignment"
    TYPE_APPROVAL = "approval"
    TYPE_FILE_UPLOAD = "file_upload"
    TYPE_EMAIL_RECEIVED = "email_received"
    TYPE_TASK_DUE = "task_due"
    TYPE_EVENT_REMINDER = "event_reminder"
    TYPE_CHOICES = [
        (TYPE_MENTION, "Mention"),
        (TYPE_COMMENT, "Comment"),
        (TYPE_LIKE, "Like"),
        (TYPE_ASSIGNMENT, "Assignment"),
        (TYPE_APPROVAL, "Approval"),
        (TYPE_FILE_UPLOAD, "File upload"),
        (TYPE_EMAIL_RECEIVED, "Email received"),
        (TYPE_TASK_DUE, "Task due"),
        (TYPE_EVENT_REMINDER, "Event reminder"),
    ]

    DIGEST_IMMEDIATE = "immediate"
    DIGEST_DAILY = "daily"
    DIGEST_WEEKLY = "weekly"
    DIGEST_CHOICES = [
        (DIGEST_IMMEDIATE, "Immediate"),
        (DIGEST_DAILY, "Daily"),
        (DIGEST_WEEKLY, "Weekly"),
    ]

    tenant = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name="notification_preferences",
        db_index=True,
    )
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="notification_preferences",
        db_index=True,
    )
    notification_type = models.CharField(max_length=32, choices=TYPE_CHOICES, db_index=True)
    in_app = models.BooleanField(default=True)
    email = models.BooleanField(default=True)
    push = models.BooleanField(default=False)
    sms = models.BooleanField(default=False)
    digest_mode = models.CharField(
        max_length=16,
        choices=DIGEST_CHOICES,
        default=DIGEST_IMMEDIATE,
    )

    class Meta:
        db_table = "notifications_preference"
        verbose_name = "notification preference"
        verbose_name_plural = "notification preferences"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "user", "notification_type"],
                name="notifpref_unique_per_user_type",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "user"], name="notifpref_user_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} {self.notification_type} (in_app={self.in_app})"


###############################################################################
# QuietHours
##############################################################################


class QuietHours(TenantModel):
    """A per-user do-not-disturb window.

    ``start_time`` / ``end_time`` are wall-clock times interpreted in
    ``timezone`` (default UTC). When ``enabled`` is ``True`` and the current
    wall-clock time falls inside the window, :func:`notifications.services.should_send`
    returns ``False`` for all non-urgent channels (email, push, sms). In-app
    rows are always created so the user catches up on return.
    """

    tenant = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name="quiet_hours",
        db_index=True,
    )
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="quiet_hours",
        db_index=True,
    )
    start_time = models.TimeField()
    end_time = models.TimeField()
    timezone = models.CharField(max_length=64, default="UTC")
    enabled = models.BooleanField(default=False)

    class Meta:
        db_table = "notifications_quiet_hours"
        verbose_name = "quiet hours"
        verbose_name_plural = "quiet hours"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "user"],
                name="quiethours_unique_per_user",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id} DND {self.start_time}-{self.end_time} ({self.timezone})"
