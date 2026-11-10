"""factory_boy factories for the notes app."""

from __future__ import annotations

from factory import LazyFunction, SubFactory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant, _current_user, UserFactory
from notes.models import Note, NoteComment, NoteShare, NoteVersion


class NoteFactory(DjangoModelFactory):
    class Meta:
        model = Note

    tenant = LazyFunction(_current_tenant)
    title = "Test note"
    body = "<p>Hello @42 and #phase-6</p>"
    body_type = "html"
    is_pinned = False
    is_private = False
    author = LazyFunction(_current_user)
    last_edited_by = LazyFunction(_current_user)
    related_module = ""
    related_id = ""
    mentions = LazyFunction(list)
    hashtags = LazyFunction(list)
    tags = LazyFunction(lambda: ["phase-6"])
    edit_history = LazyFunction(list)


class NoteShareFactory(DjangoModelFactory):
    class Meta:
        model = NoteShare

    note = SubFactory(NoteFactory)
    user = SubFactory(UserFactory)
    permission = "read"


class NoteCommentFactory(DjangoModelFactory):
    class Meta:
        model = NoteComment

    note = SubFactory(NoteFactory)
    user = LazyFunction(_current_user)
    selected_text = ""
    body = "Looks good to me."
    resolved = False


class NoteVersionFactory(DjangoModelFactory):
    class Meta:
        model = NoteVersion

    note = SubFactory(NoteFactory)
    user = LazyFunction(_current_user)
    body = "<p>v1 snapshot</p>"
    version_number = 1
