"""factory_boy factories for the attachments app."""

from __future__ import annotations

from factory import LazyFunction, SubFactory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant, _current_user
from attachments.models import Attachment
from files.factories import FileFactory


class AttachmentFactory(DjangoModelFactory):
    class Meta:
        model = Attachment

    tenant = LazyFunction(_current_tenant)
    record_module = "lead"
    record_id = "1"
    file = SubFactory(FileFactory)
    attached_by = LazyFunction(_current_user)
    description = ""
    is_inline = False
