"""Event + Meeting models — calendar events with RRULE recurrence.

Design notes
------------
* :class:`Event` inherits :class:`api.soft_delete.SoftDeleteTenantModel`
  → tenant FK (``CASCADE``), ``created_at`` / ``updated_at``, ``deleted_at``,
  and the soft-delete-aware ``objects`` / ``all_objects`` managers.
* :class:`EventAttendee` is the through model for the ``attendees`` M2M, carrying
  per-attendee ``response`` (yes/no/maybe/none) and ``required`` flags.
* :class:`Meeting` is a OneToOne profile on :class:`Event` that adds the
  meeting-specific fields (agenda, action items, engagement score, follow-up
  flag). We chose OneToOne over a separate ``Meetings`` model with FK so:
    - every Meeting is exactly one Event (no orphan meetings);
    - the ICS feed and conflict detection stay single-model;
    - the calendar UI can show Meeting metadata inline on the Event card.
* ``reminders`` is a JSONField list of ``{offset_minutes, sent}`` items —
  the beat task flips ``sent`` to ``True`` after dispatching.
* ``recurrence`` stores an RFC 5545 RRULE string (e.g.
  ``FREQ=WEEKLY;BYDAY=MO,WE,FR;INTERVAL=1;UNTIL=20251231T000000Z``). Expansion
  is handled by :mod:`events.tasks` (daily beat) via :mod:`dateutil.rrule`.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import User
from api.soft_delete import SoftDeleteTenantModel


class Event(SoftDeleteTenantModel):
    """A calendar event, optionally recurring, optionally a meeting."""

    STATUS_CONFIRMED = "confirmed"
    STATUS_TENTATIVE = "tentative"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_CONFIRMED, "Confirmed"),
        (STATUS_TENTATIVE, "Tentative"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    VISIBILITY_PUBLIC = "public"
    VISIBILITY_PRIVATE = "private"
    VISIBILITY_BUSY = "busy"
    VISIBILITY_CHOICES = [
        (VISIBILITY_PUBLIC, "Public"),
        (VISIBILITY_PRIVATE, "Private"),
        (VISIBILITY_BUSY, "Busy"),
    ]

    CONFERENCE_NONE = "none"
    CONFERENCE_GOOGLE_MEET = "google_meet"
    CONFERENCE_ZOOM = "zoom"
    CONFERENCE_TEAMS = "teams"
    CONFERENCE_CHOICES = [
        (CONFERENCE_NONE, "None"),
        (CONFERENCE_GOOGLE_MEET, "Google Meet"),
        (CONFERENCE_ZOOM, "Zoom"),
        (CONFERENCE_TEAMS, "Microsoft Teams"),
    ]

    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    start = models.DateTimeField(db_index=True)
    end = models.DateTimeField(db_index=True)
    all_day = models.BooleanField(default=False)
    location = models.CharField(max_length=255, blank=True, default="")
    attendees = models.ManyToManyField(
        User,
        through="EventAttendee",
        related_name="events",
        blank=True,
    )
    external_attendees = models.JSONField(
        default=list,
        blank=True,
        help_text="List of non-user attendee email strings.",
    )
    recurrence = models.TextField(
        blank=True,
        default="",
        help_text="RFC 5545 RRULE string. Empty = one-off event.",
    )
    reminders = models.JSONField(
        default=list,
        blank=True,
        help_text="List of {offset_minutes, sent} reminder specs.",
    )
    conference_url = models.URLField(max_length=1024, blank=True, default="")
    conference_provider = models.CharField(
        max_length=32,
        choices=CONFERENCE_CHOICES,
        default=CONFERENCE_NONE,
    )
    related_module = models.CharField(
        max_length=32,
        blank=True,
        default="",
        db_index=True,
        help_text="CRM module this event relates to (lead/contact/account/deal) if any.",
    )
    related_id = models.CharField(
        max_length=64,
        blank=True,
        default="",
        db_index=True,
    )
    status = models.CharField(
        max_length=16,
        choices=STATUS_CHOICES,
        default=STATUS_CONFIRMED,
        db_index=True,
    )
    organizer = models.ForeignKey(
        User,
        on_delete=models.RESTRICT,
        related_name="organized_events",
    )
    visibility = models.CharField(
        max_length=16,
        choices=VISIBILITY_CHOICES,
        default=VISIBILITY_PUBLIC,
    )
    last_expanded_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        help_text="Last time the recurring-event generator advanced this event.",
    )

    class Meta:
        db_table = "events_event"
        verbose_name = "event"
        verbose_name_plural = "events"
        ordering = ["-start"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(status__in=("confirmed", "tentative", "cancelled")),
                name="events_status_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(visibility__in=("public", "private", "busy")),
                name="events_visibility_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    conference_provider__in=("none", "google_meet", "zoom", "teams")
                ),
                name="events_conference_provider_valid",
            ),
            models.CheckConstraint(
                # ``end`` must be at-or-after ``start``. NULL start/end are not
                # allowed by the field definitions, so the condition is safe.
                condition=models.Q(end__gte=models.F("start")),
                name="events_end_gte_start",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "deleted_at"], name="events_tenant_deleted_idx"),
            models.Index(fields=["tenant", "start"], name="events_tenant_start_idx"),
            models.Index(fields=["tenant", "organizer"], name="events_tenant_organizer_idx"),
            models.Index(fields=["tenant", "status"], name="events_tenant_status_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.title} @ {self.start:%Y-%m-%d %H:%M}" if self.start else self.title

    # ------------------------------------------------------------------ helpers

    def touch(self) -> None:
        """No-op stub for symmetry with the other CRM models."""
        self.save(update_fields=["updated_at"])


class EventAttendee(models.Model):
    """Through model for ``Event.attendees`` — per-attendee RSVP state."""

    RESPONSE_YES = "yes"
    RESPONSE_NO = "no"
    RESPONSE_MAYBE = "maybe"
    RESPONSE_NONE = "none"
    RESPONSE_CHOICES = [
        (RESPONSE_YES, "Yes"),
        (RESPONSE_NO, "No"),
        (RESPONSE_MAYBE, "Maybe"),
        (RESPONSE_NONE, "No response"),
    ]

    event = models.ForeignKey(
        Event,
        on_delete=models.CASCADE,
        related_name="attendee_links",
        db_index=True,
    )
    user = models.ForeignKey(
        User,
        on_delete=models.RESTRICT,
        related_name="event_attendances",
        db_index=True,
    )
    response = models.CharField(
        max_length=8,
        choices=RESPONSE_CHOICES,
        default=RESPONSE_NONE,
    )
    required = models.BooleanField(default=True)
    responded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "events_event_attendee"
        verbose_name = "event attendee"
        verbose_name_plural = "event attendees"
        constraints = [
            models.UniqueConstraint(
                fields=["event", "user"],
                name="eventattendee_unique_per_event_user",
            ),
            models.CheckConstraint(
                condition=models.Q(response__in=("yes", "no", "maybe", "none")),
                name="eventattendee_response_valid",
            ),
        ]
        indexes = [
            models.Index(fields=["user", "response"], name="ea_user_response_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.user.email} → {self.event} ({self.response})"

    def mark_response(self, response: str) -> None:
        """Set the RSVP and stamp ``responded_at``."""
        self.response = response
        self.responded_at = timezone.now()
        self.save(update_fields=["response", "responded_at"])


class Meeting(models.Model):
    """Meeting profile for an :class:`Event` — agenda + action items.

    One-to-one with :class:`Event`. Created lazily by the viewset when a client
    first asks for meeting-specific fields (agenda, action items, engagement
    score) on an event.
    """

    event = models.OneToOneField(
        Event,
        on_delete=models.CASCADE,
        related_name="meeting_profile",
        primary_key=True,
    )
    agenda = models.TextField(blank=True, default="")
    action_items = models.JSONField(
        default=list,
        blank=True,
        help_text="List of {text, done, assignee_id} items.",
    )
    follow_up_tasks_created = models.BooleanField(default=False)
    engagement_score = models.FloatField(
        default=0.0,
        help_text="0-100 engagement score (computed by the meeting-summary worker).",
    )

    class Meta:
        db_table = "events_meeting"
        verbose_name = "meeting"
        verbose_name_plural = "meetings"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(engagement_score__gte=0.0)
                & models.Q(engagement_score__lte=100.0),
                name="meeting_engagement_score_range",
            ),
        ]

    def __str__(self) -> str:
        return f"Meeting: {self.event}"
