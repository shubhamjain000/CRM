"""DRF ViewSet for the events app.

Provides CRUD + custom actions: ``ics_export`` (GET → ICS feed for the
caller), ``detect_conflicts`` (POST → list of conflicting events),
``respond`` (POST → RSVP the caller's attendance).
"""

from __future__ import annotations

from typing import Any, Iterable

from django.http import HttpResponse
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from api.crm_base import CRMModelViewSet
from api.permissions import HasPermission, IsTenantMember
from events.filters import EventFilter
from events.models import Event, EventAttendee, Meeting
from events.serializers import (
    ConflictCheckSerializer,
    EventRespondSerializer,
    EventSerializer,
    MeetingSerializer,
)
from events.services import detect_conflicts, generate_conference_link, generate_ics


class EventViewSet(CRMModelViewSet):
    """CRUD + productivity actions for :class:`events.models.Event`."""

    serializer_class = EventSerializer
    queryset = (
        Event.objects.all()
        .select_related("organizer", "meeting_profile")
        .prefetch_related("attendee_links__user")
    )
    filterset_class = EventFilter
    sort_fields: tuple[str, ...] = (
        "id",
        "title",
        "start",
        "end",
        "status",
        "organizer",
        "visibility",
        "created_at",
        "updated_at",
    )
    bulk_update_fields: tuple[str, ...] = (
        "status",
        "visibility",
        "location",
        "conference_provider",
    )
    required_permission: Iterable[str] | str = "crm.events.read"

    def get_permissions(self) -> Any:
        method = self.request.method or ""
        if method in ("GET", "HEAD", "OPTIONS"):
            perm = "crm.events.read"
        elif method == "POST":
            perm = "crm.events.create"
        elif method in ("PUT", "PATCH"):
            perm = "crm.events.update"
        elif method == "DELETE":
            perm = "crm.events.delete"
        else:
            return [IsAuthenticated(), IsTenantMember()]
        return [IsAuthenticated(), IsTenantMember(), HasPermission(perm)]

    def perform_create(self, serializer: EventSerializer) -> None:  # type: ignore[override]
        instance: Event = serializer.save(tenant=self.request.tenant)  # type: ignore[attr-defined]
        # Auto-create conference link if a provider was set.
        if (
            instance.conference_provider
            and instance.conference_provider != "none"
            and not instance.conference_url
        ):
            instance.conference_url = generate_conference_link(
                instance.conference_provider, instance
            )
            instance.save(update_fields=["conference_url", "updated_at"])

    def perform_update(self, serializer: EventSerializer) -> None:  # type: ignore[override]
        instance: Event = serializer.save()
        if (
            instance.conference_provider
            and instance.conference_provider != "none"
            and not instance.conference_url
        ):
            instance.conference_url = generate_conference_link(
                instance.conference_provider, instance
            )
            instance.save(update_fields=["conference_url", "updated_at"])

    # ------------------------------------------------------------------ ICS export

    @action(detail=False, methods=["get"], url_path="ics-export")
    def ics_export(self, request: Request) -> HttpResponse:
        """Return an ICS calendar feed of the caller's events."""
        ics_text = generate_ics(
            tenant=getattr(request, "tenant", None),
            user=request.user,
        )
        response = HttpResponse(ics_text, content_type="text/calendar; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="foundation.ics"'
        return response

    # ------------------------------------------------------------------ conflict detection

    @action(detail=False, methods=["post"], url_path="detect-conflicts")
    def detect_conflicts_action(self, request: Request) -> Response:
        """POST ``{start, end, exclude_event_id?}`` → list of conflicting events."""
        serializer = ConflictCheckSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        conflicts = detect_conflicts(
            tenant=getattr(request, "tenant", None),
            user=request.user,
            start=data["start"],
            end=data["end"],
            exclude_event_id=data.get("exclude_event_id"),
        )
        return Response(
            {
                "count": len(conflicts),
                "results": EventSerializer(
                    conflicts, many=True, context={"request": request}
                ).data,
            }
        )

    # ------------------------------------------------------------------ RSVP

    @action(detail=True, methods=["post"], url_path="respond")
    def respond(self, request: Request, pk: str | None = None) -> Response:
        """RSVP the caller's attendance on this event.

        Creates the :class:`EventAttendee` row if the caller isn't already an
        attendee (so an organizer can forward the event URL + have invitees
        self-RSVP). Returns the upserted attendee row.
        """
        event: Event = self.get_object()
        serializer = EventRespondSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        response_value = serializer.validated_data["response"]

        attendee, _created = EventAttendee.objects.get_or_create(
            event=event,
            user=request.user,
            defaults={"response": response_value, "required": False},
        )
        # Always stamp responded_at (covers the newly-created case where the
        # row's responded_at is still NULL).
        attendee.mark_response(response_value)
        return Response(
            {
                "event_id": event.pk,
                "user_id": request.user.pk,
                "response": attendee.response,
                "responded_at": attendee.responded_at,
            }
        )

    # ------------------------------------------------------------------ meeting profile

    @action(detail=True, methods=["get", "patch"], url_path="meeting")
    def meeting_profile(self, request: Request, pk: str | None = None) -> Response:
        """Get or update the meeting profile for this event (lazy-create)."""
        event: Event = self.get_object()
        meeting, _created = Meeting.objects.get_or_create(event=event)
        if request.method == "PATCH":
            serializer = MeetingSerializer(meeting, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            meeting.refresh_from_db()
        return Response(MeetingSerializer(meeting, context={"request": request}).data)
