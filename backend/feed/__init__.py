"""Feed app — Chatter-like activity feed for the CRM.

Provides:

* :class:`feed.models.FeedPost` — a tenant-scoped post authored by a user, with
  body text, @mentions, #hashtags, attachments, an optional CRM-record link,
  pinning, soft delete, and a many-to-many ``likes`` relation through
  :class:`FeedReaction`.
* :class:`feed.models.FeedComment` — a threaded reply on a post.
* :class:`feed.models.FeedReaction` — a single-emoji reaction by a user on a
  post or a comment.

Endpoints mount under ``/api/v1/`` (``feed/posts/``, ``feed/comments/``,
``feed/reactions/``).
"""
