"""factory_boy factories for the social app."""

from __future__ import annotations

from datetime import timedelta

import factory
from django.utils import timezone
from factory.django import DjangoModelFactory

from api.factories import _current_tenant
from social.models import (
    POST_SCHEDULED,
    PROVIDER_TWITTER,
    ScheduledPost,
    SocialAccount,
    SocialMention,
)


class SocialAccountFactory(DjangoModelFactory):
    """Factory for :class:`SocialAccount`."""

    class Meta:
        model = SocialAccount

    tenant = factory.LazyFunction(_current_tenant)
    provider = PROVIDER_TWITTER
    handle = factory.Sequence(lambda n: f"handle{n}")
    access_token = "secret-token"
    is_active = True


class SocialMentionFactory(DjangoModelFactory):
    """Factory for :class:`SocialMention`."""

    class Meta:
        model = SocialMention

    tenant = factory.LazyFunction(_current_tenant)
    account = factory.SubFactory(SocialAccountFactory)
    provider = PROVIDER_TWITTER
    message_id = factory.Sequence(lambda n: f"mid-{n}")
    author = factory.Faker("name")
    author_handle = factory.Sequence(lambda n: f"@user{n}")
    body = factory.Sequence(lambda n: f"Mention body {n}")
    media = factory.LazyFunction(lambda: [])
    url = "https://twitter.com/example"
    sentiment = "neutral"
    is_read = False


class ScheduledPostFactory(DjangoModelFactory):
    """Factory for :class:`ScheduledPost`."""

    class Meta:
        model = ScheduledPost

    tenant = factory.LazyFunction(_current_tenant)
    account = factory.SubFactory(SocialAccountFactory)
    content = factory.Sequence(lambda n: f"Post content {n}")
    media = factory.LazyFunction(lambda: [])
    scheduled_at = factory.LazyFunction(lambda: timezone.now() + timedelta(minutes=5))
    status = POST_SCHEDULED


__all__ = [
    "ScheduledPostFactory",
    "SocialAccountFactory",
    "SocialMentionFactory",
]
