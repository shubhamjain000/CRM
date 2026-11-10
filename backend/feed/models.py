"""Activity-feed models.

Design notes
------------
* All three models inherit :class:`api.models.TenantModel` (tenant FK +
  ``created_at`` / ``updated_at``) and are scoped by
  :class:`api.managers.TenantManager`.
* :class:`FeedPost` carries a soft-delete flag (``deleted_at``) so authors can
  remove a post without breaking threaded comments or reaction history. Lists
  filter ``deleted_at__isnull=True``.
* The ``likes`` M2M on :class:`FeedPost` goes through :class:`FeedReaction` so
  we can store the emoji + created_at per reaction. A separate ``likes``
  accessor is intentionally not exposed — the serializer computes counts per
  emoji from the related ``reactions`` set.
* :class:`FeedReaction` is "polymorphic" — exactly one of ``post`` / ``comment``
  is non-null. A CHECK constraint enforces this at the DB level.
* ``mentions`` / ``hashtags`` / ``attachments`` are JSONField lists parsed out
  of the body by :mod:`feed.signals` on every save. Client-supplied values are
  ignored (the serializer marks them read-only).
"""

from __future__ import annotations

from django.db import models
from django.utils import timezone

from api.models import Organization, TenantModel, User


###############################################################################
# FeedPost
###############################################################################


class FeedPost(TenantModel):
    """A user-authored post in the tenant activity feed.

    ``related_module`` + ``related_id`` optionally scope the post to a CRM
    record (lead / contact / account / deal / task / event / note). When both
    are blank the post appears in the tenant's *global* feed.

    ``mentions`` and ``hashtags`` are denormalized JSONField lists parsed out
    of ``body`` by :mod:`feed.signals` (post_save). ``attachments`` is a list
    of file IDs (the frontend resolves them via the ``attachments`` app).
    """

    tenant = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name="feed_posts",
        db_index=True,
    )
    author = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="feed_posts",
        db_index=True,
    )
    body = models.TextField(help_text="Rich text / HTML body of the post.")
    mentions = models.JSONField(
        default=list,
        blank=True,
        help_text="List of user IDs extracted from @mentions in the body.",
    )
    hashtags = models.JSONField(
        default=list,
        blank=True,
        help_text="List of #hashtags extracted from the body (lowercased, de-duped).",
    )
    attachments = models.JSONField(
        default=list,
        blank=True,
        help_text="List of file IDs attached to the post.",
    )
    related_module = models.CharField(
        max_length=32,
        blank=True,
        default="",
        db_index=True,
        help_text="CRM module this post relates to (lead/contact/account/deal/task/event/note).",
    )
    related_id = models.CharField(
        max_length=64,
        blank=True,
        default="",
        db_index=True,
    )
    is_pinned = models.BooleanField(default=False, db_index=True)
    likes = models.ManyToManyField(
        User,
        through="FeedReaction",
        through_fields=("post", "user"),
        related_name="liked_feed_posts",
        blank=True,
    )
    edited_at = models.DateTimeField(null=True, blank=True, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        db_table = "feed_post"
        verbose_name = "feed post"
        verbose_name_plural = "feed posts"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["tenant", "-created_at"], name="feed_post_created_idx"),
            models.Index(
                fields=["tenant", "related_module", "related_id"],
                name="feed_post_related_idx",
            ),
            models.Index(fields=["tenant", "author"], name="feed_post_author_idx"),
            models.Index(fields=["tenant", "is_pinned"], name="feed_post_pinned_idx"),
            models.Index(fields=["tenant", "deleted_at"], name="feed_post_deleted_idx"),
        ]

    def __str__(self) -> str:
        preview = (self.body or "")[:60].replace("\n", " ")
        return f"Post by {self.author_id}: {preview!r}"

    # ------------------------------------------------------------------ helpers

    @property
    def is_deleted(self) -> bool:
        """Return ``True`` if the post has been soft-deleted."""
        return self.deleted_at is not None

    def soft_delete(self, *, user: User | None = None) -> None:
        """Mark the post as soft-deleted (idempotent)."""
        if self.deleted_at is None:
            self.deleted_at = timezone.now()
            self.save(update_fields=["deleted_at", "updated_at"])

    def restore(self) -> None:
        """Clear the soft-delete flag."""
        if self.deleted_at is not None:
            self.deleted_at = None
            self.save(update_fields=["deleted_at", "updated_at"])


###############################################################################
# FeedComment
###############################################################################


class FeedComment(TenantModel):
    """A threaded reply on a :class:`FeedPost`.

    Like posts, comments carry a ``mentions`` JSONField parsed from the body
    and a soft-delete flag. A comment's ``tenant`` always matches its parent
    post's tenant (enforced by the viewset on create).
    """

    tenant = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name="feed_comments",
        db_index=True,
    )
    post = models.ForeignKey(
        FeedPost,
        on_delete=models.CASCADE,
        related_name="comments",
        db_index=True,
    )
    author = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="feed_comments",
        db_index=True,
    )
    body = models.TextField()
    mentions = models.JSONField(
        default=list,
        blank=True,
        help_text="List of user IDs extracted from @mentions in the body.",
    )
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        db_table = "feed_comment"
        verbose_name = "feed comment"
        verbose_name_plural = "feed comments"
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["post", "created_at"], name="feed_comment_created_idx"),
            models.Index(fields=["post", "deleted_at"], name="feed_comment_deleted_idx"),
        ]

    def __str__(self) -> str:
        preview = (self.body or "")[:60].replace("\n", " ")
        return f"Comment by {self.author_id}: {preview!r}"

    @property
    def is_deleted(self) -> bool:
        """Return ``True`` if the comment has been soft-deleted."""
        return self.deleted_at is not None


###############################################################################
# FeedReaction
##############################################################################


class FeedReaction(TenantModel):
    """A single-emoji reaction by a user on a post *or* a comment.

    Exactly one of ``post`` / ``comment`` must be non-null. A CHECK constraint
    enforces this at the DB level (PostgreSQL only — SQLite ignores CHECKs in
    older versions, so the serializer also validates this).
    """

    tenant = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name="feed_reactions",
        db_index=True,
    )
    post = models.ForeignKey(
        FeedPost,
        on_delete=models.CASCADE,
        related_name="reactions",
        null=True,
        blank=True,
        db_index=True,
    )
    comment = models.ForeignKey(
        FeedComment,
        on_delete=models.CASCADE,
        related_name="reactions",
        null=True,
        blank=True,
        db_index=True,
    )
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="feed_reactions",
        db_index=True,
    )
    emoji = models.CharField(
        max_length=16,
        default="👍",
        help_text="A single grapheme emoji (👍 ❤️ 🎉 😮 😢 etc.).",
    )

    class Meta:
        db_table = "feed_reaction"
        verbose_name = "feed reaction"
        verbose_name_plural = "feed reactions"
        ordering = ["-created_at"]
        constraints = [
            # Exactly one of post / comment must be set.
            models.CheckConstraint(
                condition=(
                    models.Q(post__isnull=False, comment__isnull=True)
                    | models.Q(post__isnull=True, comment__isnull=False)
                ),
                name="feed_reaction_target_xor",
            ),
            # One reaction per (user, post, emoji).
            models.UniqueConstraint(
                fields=["tenant", "user", "post", "emoji"],
                name="feed_reaction_unique_post_emoji",
                condition=models.Q(post__isnull=False),
            ),
            # One reaction per (user, comment, emoji).
            models.UniqueConstraint(
                fields=["tenant", "user", "comment", "emoji"],
                name="feed_reaction_unique_comment_emoji",
                condition=models.Q(comment__isnull=False),
            ),
        ]
        indexes = [
            models.Index(fields=["post"], name="feed_reaction_post_idx"),
            models.Index(fields=["comment"], name="feed_reaction_comment_idx"),
        ]

    def __str__(self) -> str:
        target = f"post:{self.post_id}" if self.post_id else f"comment:{self.comment_id}"
        return f"{self.user_id} {self.emoji} on {target}"
