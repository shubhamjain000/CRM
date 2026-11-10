"""Database models for the social app.

All three models are tenant-scoped (inherit :class:`api.models.TenantModel`)
and follow the established pattern (TenantManager + TimestampedModel):

* :class:`SocialAccount` — a connected social handle on a supported
  provider (Twitter / LinkedIn / Facebook / Instagram). ``access_token``
  is stored as a plain ``TextField`` but should be encrypted at the
  application layer (mirrors the :class:`api.models.OAuthToken` convention).
* :class:`SocialMention` — a single inbound mention / DM / comment on a
  social account, with sentiment classification, assignment, and CRM-record
  linkage.
* :class:`ScheduledPost` — a queued outbound post scheduled for a future
  timestamp; the ``social-publish-scheduled`` Celery beat task dispatches
  due posts.
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import TenantModel, User

###############################################################################
# Constants — providers, sentiment, scheduled-post status
###############################################################################

PROVIDER_TWITTER = "twitter"
PROVIDER_LINKEDIN = "linkedin"
PROVIDER_FACEBOOK = "facebook"
PROVIDER_INSTAGRAM = "instagram"
PROVIDER_CHOICES = [
    (PROVIDER_TWITTER, "Twitter / X"),
    (PROVIDER_LINKEDIN, "LinkedIn"),
    (PROVIDER_FACEBOOK, "Facebook"),
    (PROVIDER_INSTAGRAM, "Instagram"),
]

SENTIMENT_POSITIVE = "positive"
SENTIMENT_NEUTRAL = "neutral"
SENTIMENT_NEGATIVE = "negative"
SENTIMENT_CHOICES = [
    (SENTIMENT_POSITIVE, "Positive"),
    (SENTIMENT_NEUTRAL, "Neutral"),
    (SENTIMENT_NEGATIVE, "Negative"),
]

POST_SCHEDULED = "scheduled"
POST_POSTED = "posted"
POST_FAILED = "failed"
POST_STATUS_CHOICES = [
    (POST_SCHEDULED, "Scheduled"),
    (POST_POSTED, "Posted"),
    (POST_FAILED, "Failed"),
]


###############################################################################
# SocialAccount
###############################################################################


class SocialAccount(TenantModel):
    """A connected social-media handle."""

    provider = models.CharField(max_length=32, choices=PROVIDER_CHOICES, db_index=True)
    handle = models.CharField(max_length=255, db_index=True)
    access_token = models.TextField(
        help_text="Encrypted at the application layer; never serialized.",
    )
    is_active = models.BooleanField(default=True, db_index=True)

    class Meta:
        db_table = "social_account"
        verbose_name = "social account"
        verbose_name_plural = "social accounts"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "provider", "is_active"], name="social_acct_idx"),
        ]
        unique_together = (("tenant", "provider", "handle"),)

    def __str__(self) -> str:
        return f"{self.provider}/{self.handle}"


###############################################################################
# SocialMention
###############################################################################


class SocialMention(TenantModel):
    """An inbound mention / DM / comment on a :class:`SocialAccount`."""

    account = models.ForeignKey(
        SocialAccount,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="mentions",
        db_index=True,
    )
    provider = models.CharField(max_length=32, choices=PROVIDER_CHOICES, db_index=True)
    message_id = models.CharField(max_length=255, db_index=True)
    author = models.CharField(max_length=255)
    author_handle = models.CharField(max_length=255, blank=True, default="")
    body = models.TextField()
    media = models.JSONField(default=list, blank=True)
    url = models.URLField(blank=True, default="")
    sentiment = models.CharField(
        max_length=16, choices=SENTIMENT_CHOICES, blank=True, default="", db_index=True
    )
    is_read = models.BooleanField(default=False, db_index=True)
    assigned_to = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="social_mentions",
        db_index=True,
    )
    related_module = models.CharField(max_length=64, blank=True, default="", db_index=True)
    related_id = models.CharField(max_length=64, blank=True, default="", db_index=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    responded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "social_mention"
        verbose_name = "social mention"
        verbose_name_plural = "social mentions"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "provider", "created_at"], name="social_mention_idx"),
            models.Index(fields=["tenant", "is_read"], name="social_mention_read_idx"),
        ]
        unique_together = (("tenant", "provider", "message_id"),)

    def __str__(self) -> str:
        return f"{self.provider}/{self.author_handle or self.author}: {self.body[:40]}"


###############################################################################
# ScheduledPost
###############################################################################


class ScheduledPost(TenantModel):
    """A queued outbound social post."""

    account = models.ForeignKey(
        SocialAccount,
        on_delete=models.CASCADE,
        related_name="scheduled_posts",
        db_index=True,
    )
    content = models.TextField()
    media = models.JSONField(default=list, blank=True)
    scheduled_at = models.DateTimeField(db_index=True)
    status = models.CharField(
        max_length=16, choices=POST_STATUS_CHOICES, default=POST_SCHEDULED, db_index=True
    )
    posted_at = models.DateTimeField(null=True, blank=True)
    error_message = models.TextField(blank=True, default="")

    class Meta:
        db_table = "social_scheduled_post"
        verbose_name = "scheduled post"
        verbose_name_plural = "scheduled posts"
        ordering = ["scheduled_at"]
        indexes = [
            models.Index(fields=["tenant", "scheduled_at"], name="social_post_sched_idx"),
        ]

    def __str__(self) -> str:
        return f"ScheduledPost {self.pk} ({self.status})"


__all__ = [
    "POST_FAILED",
    "POST_POSTED",
    "POST_SCHEDULED",
    "POST_STATUS_CHOICES",
    "PROVIDER_CHOICES",
    "PROVIDER_FACEBOOK",
    "PROVIDER_INSTAGRAM",
    "PROVIDER_LINKEDIN",
    "PROVIDER_TWITTER",
    "SENTIMENT_CHOICES",
    "SENTIMENT_NEGATIVE",
    "SENTIMENT_NEUTRAL",
    "SENTIMENT_POSITIVE",
    "ScheduledPost",
    "SocialAccount",
    "SocialMention",
]
