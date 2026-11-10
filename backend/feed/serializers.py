"""DRF serializers for the feed app.

None of these serializers expose the ``tenant`` field — it is always set
implicitly from ``request.tenant`` (bound by
:class:`api.middleware.TenantMiddleware`).
"""

from __future__ import annotations

from typing import Any

from rest_framework import serializers

from api.models import User

from .models import FeedComment, FeedPost, FeedReaction
from .services import parse_mentions_and_hashtags, reaction_counts


class _AuthorField(serializers.ModelSerializer):
    """Compact author representation: id, name, email, avatar_url."""

    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "name", "email", "avatar_url"]
        read_only_fields = fields

    def get_avatar_url(self, obj: User) -> str:
        profile = getattr(obj, "profile", None)
        return profile.avatar_url if profile else ""


class FeedReactionSerializer(serializers.ModelSerializer):
    """Serializer for :class:`feed.models.FeedReaction`.

    On create the caller must supply either ``post`` or ``comment`` (not both).
    The viewset enforces tenant scoping on the target before saving.
    """

    user = _AuthorField(read_only=True)

    class Meta:
        model = FeedReaction
        fields = [
            "id",
            "post",
            "comment",
            "user",
            "emoji",
            "created_at",
        ]
        read_only_fields = ["id", "user", "created_at"]

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        post = attrs.get("post") or (self.instance.post if self.instance else None)
        comment = attrs.get("comment") or (self.instance.comment if self.instance else None)
        if bool(post) == bool(comment):
            raise serializers.ValidationError(
                "Exactly one of `post` or `comment` must be set."
            )
        return attrs


class FeedCommentSerializer(serializers.ModelSerializer):
    """Serializer for :class:`feed.models.FeedComment`.

    ``mentions`` is parsed from ``body`` on create / update
    (client-supplied values are ignored).
    """

    author = _AuthorField(read_only=True)
    reaction_summary = serializers.SerializerMethodField()

    class Meta:
        model = FeedComment
        fields = [
            "id",
            "post",
            "author",
            "body",
            "mentions",
            "reaction_summary",
            "deleted_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "author",
            "mentions",
            "reaction_summary",
            "deleted_at",
            "created_at",
            "updated_at",
        ]

    def _resolve_tenant(self) -> Any:
        request = self.context.get("request")
        return getattr(request, "tenant", None) if request else None

    def _enrich(self, validated_data: dict[str, Any]) -> dict[str, Any]:
        body = validated_data.get("body", "")
        parsed = parse_mentions_and_hashtags(body, tenant=self._resolve_tenant())
        validated_data["mentions"] = parsed["mentions"]
        return validated_data

    def create(self, validated_data: dict[str, Any]) -> FeedComment:  # type: ignore[override]
        return super().create(self._enrich(validated_data))

    def update(self, instance: FeedComment, validated_data: dict[str, Any]) -> FeedComment:  # type: ignore[override]
        return super().update(instance, self._enrich(validated_data))

    def get_reaction_summary(self, obj: FeedComment) -> list[dict[str, Any]]:
        return reaction_counts(obj.reactions.all())


class FeedPostSerializer(serializers.ModelSerializer):
    """Serializer for :class:`feed.models.FeedPost`.

    ``mentions`` and ``hashtags`` are parsed from ``body`` on create / update
    (client-supplied values are ignored).
    """

    author = _AuthorField(read_only=True)
    reaction_summary = serializers.SerializerMethodField()
    comment_count = serializers.SerializerMethodField()
    is_liked = serializers.SerializerMethodField()

    class Meta:
        model = FeedPost
        fields = [
            "id",
            "author",
            "body",
            "mentions",
            "hashtags",
            "attachments",
            "related_module",
            "related_id",
            "is_pinned",
            "reaction_summary",
            "comment_count",
            "is_liked",
            "edited_at",
            "deleted_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "author",
            "mentions",
            "hashtags",
            "reaction_summary",
            "comment_count",
            "is_liked",
            "edited_at",
            "deleted_at",
            "created_at",
            "updated_at",
        ]

    # ------------------------------------------------------------------ helpers

    def _resolve_tenant(self) -> Any:
        request = self.context.get("request")
        return getattr(request, "tenant", None) if request else None

    def _resolve_user(self) -> User | None:
        request = self.context.get("request")
        return getattr(request, "user", None) if request else None

    def _enrich(self, validated_data: dict[str, Any]) -> dict[str, Any]:
        body = validated_data.get("body", "")
        parsed = parse_mentions_and_hashtags(body, tenant=self._resolve_tenant())
        validated_data["mentions"] = parsed["mentions"]
        validated_data["hashtags"] = parsed["hashtags"]
        return validated_data

    def create(self, validated_data: dict[str, Any]) -> FeedPost:  # type: ignore[override]
        return super().create(self._enrich(validated_data))

    def update(self, instance: FeedPost, validated_data: dict[str, Any]) -> FeedPost:  # type: ignore[override]
        enriched = self._enrich(validated_data)
        # If the body changed, stamp edited_at.
        if "body" in enriched and enriched["body"] != instance.body:
            from django.utils import timezone

            enriched["edited_at"] = timezone.now()
        return super().update(instance, enriched)

    # ------------------------------------------------------------------ computed

    def get_reaction_summary(self, obj: FeedPost) -> list[dict[str, Any]]:
        return reaction_counts(obj.reactions.all())

    def get_comment_count(self, obj: FeedPost) -> int:
        return obj.comments.filter(deleted_at__isnull=True).count()

    def get_is_liked(self, obj: FeedPost) -> bool:
        user = self._resolve_user()
        if not user or not getattr(user, "is_authenticated", False):
            return False
        return obj.reactions.filter(user=user).exists()
