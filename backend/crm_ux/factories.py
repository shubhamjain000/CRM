"""factory_boy factories for the crm_ux app.

Each factory lazily attaches the active thread-local tenant (set via
``tenant_context`` in tests) and the first user in the DB, mirroring the
pattern in :mod:`api.factories`.
"""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant, _current_user
from crm_ux.models import (
    Activity,
    FileAttachment,
    Note,
    RecordLock,
    RecentlyViewed,
    SavedView,
)


class SavedViewFactory(DjangoModelFactory):
    """Factory for :class:`crm_ux.models.SavedView`."""

    class Meta:
        model = SavedView

    tenant = factory.LazyFunction(_current_tenant)
    user = factory.LazyFunction(_current_user)
    module = "lead"
    name = factory.Sequence(lambda n: f"View {n}")
    is_shared = False
    config = factory.LazyFunction(lambda: {"filters": [], "sort": [], "columns": [], "groupBy": None})
    is_default = False


class RecentlyViewedFactory(DjangoModelFactory):
    """Factory for :class:`crm_ux.models.RecentlyViewed`."""

    class Meta:
        model = RecentlyViewed

    tenant = factory.LazyFunction(_current_tenant)
    user = factory.LazyFunction(_current_user)
    module = "lead"
    record_id = factory.Sequence(lambda n: str(n + 1))


class ActivityFactory(DjangoModelFactory):
    """Factory for :class:`crm_ux.models.Activity`."""

    class Meta:
        model = Activity

    tenant = factory.LazyFunction(_current_tenant)
    user = factory.LazyFunction(_current_user)
    module = "lead"
    record_id = factory.Sequence(lambda n: str(n + 1))
    record_name = factory.Faker("name")
    action = "created"
    description = ""
    metadata = factory.LazyFunction(dict)


class NoteFactory(DjangoModelFactory):
    """Factory for :class:`crm_ux.models.Note`."""

    class Meta:
        model = Note

    tenant = factory.LazyFunction(_current_tenant)
    user = factory.LazyFunction(_current_user)
    module = "lead"
    record_id = factory.Sequence(lambda n: str(n + 1))
    body = factory.Faker("sentence")
    mentions = factory.LazyFunction(list)
    hashtags = factory.LazyFunction(list)


class FileAttachmentFactory(DjangoModelFactory):
    """Factory for :class:`crm_ux.models.FileAttachment`."""

    class Meta:
        model = FileAttachment

    tenant = factory.LazyFunction(_current_tenant)
    user = factory.LazyFunction(_current_user)
    module = "lead"
    record_id = factory.Sequence(lambda n: str(n + 1))
    filename = "test.txt"
    file_url = "http://example.com/test.txt"
    file_size = 1024
    mime_type = "text/plain"
    s3_key = "crm_ux/test/test.txt"


class RecordLockFactory(DjangoModelFactory):
    """Factory for :class:`crm_ux.models.RecordLock`."""

    class Meta:
        model = RecordLock

    tenant = factory.LazyFunction(_current_tenant)
    user = factory.LazyFunction(_current_user)
    module = "lead"
    record_id = factory.Sequence(lambda n: str(n + 1))
