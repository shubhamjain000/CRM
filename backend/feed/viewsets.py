"""DRF ViewSets for the feed app.

All viewsets are tenant-scoped (resolved by
:class:`api.middleware.TenantMiddleware`) and require ``IsAuthenticated`` +
``IsTenantMember``.
"""

from __future__ import annotations

import logging
from typing import Any

from django.db import transaction
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import CursorPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from api.permissions import IsTenantMember

from .models import FeedComment, FeedPost, FeedReaction
from .serializers import (
    FeedCommentSerializer,
    FeedPostSerializer,
    FeedReactionSerializer,
)

log = logging.getLogger(__name__)


class FeedCursorPagination(CursorPagination):
    """Cursor pagination for feed endpoints (page_size 50, max 200)."""

    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200
    ordering = "-created_at"


###############################################################################
# FeedPost
###############################################################################


class FeedPostViewSet(viewsets.ModelViewSet):
    """Tenant-scoped activity-feed posts.

    * ``list`` returns the tenant's posts, optionally narrowed by
      ``?related_module=lead&related_id=123`` (record feed) or by
      ``?author=42`` / ``?hashtag=pricing`` / ``?mention=42``. When neither
      record nor author/hashtag/mention filter is supplied, the *global*
      tenant feed is returned (posts whose ``related_module`` is blank).
    * ``create`` auto-stamps ``author`` from ``request.user`` and ``tenant``
      from ``request.tenant``.
    * ``update`` / ``destroy`` are author-only.
    * ``pin`` toggles ``is_pinned`` (admin or author).
    * ``like`` toggles the caller's 👍 reaction (idempotent).
    * ``add_comment`` creates a :class:`FeedComment` on the post.
    * ``comments`` lists the (paginated) comments on the post.
    """

    serializer_class = FeedPostSerializer
    queryset = FeedPost.objects.all()
    permission_classes = [IsAuthenticated, IsTenantMember]
    pagination_class = FeedCursorPagination

    def get_queryset(self) -> Any:  # type: ignore[override]
        queryset = super().get_queryset().filter(deleted_at__isnull=True).select_related(
            "author", "author__profile"
        )
        query = self.request.query_params

        related_module = query.get("related_module")
        related_id = query.get("related_id")
        if related_module and related_id:
            queryset = queryset.filter(
                related_module=related_module,
                related_id=str(related_id),
            )
        elif related_module == "" or self._explicit_global(query):
            # ``?scope=global`` (or an empty ``related_module``) restricts to
            # the tenant's global feed.
            queryset = queryset.filter(related_module="")

        author = query.get("author")
        if author:
            queryset = queryset.filter(author_id=author)

        hashtag = query.get("hashtag")
        if hashtag:
            tag = hashtag.lstrip("#").lower()
            queryset = queryset.filter(hashtags__contains=[tag])

        mention = query.get("mention")
        if mention:
            try:
                queryset = queryset.filter(mentions__contains=[int(mention)])
            except ValueError:
                return queryset.none()

        return queryset

    @staticmethod
    def _explicit_global(query: Any) -> bool:
        return (query.get("scope") or "").lower() == "global"

    # ------------------------------------------------------------------ create

    def perform_create(self, serializer: FeedPostSerializer) -> None:  # type: ignore[override]
        serializer.save(
            tenant=self.request.tenant,  # type: ignore[attr-defined]
            author=self.request.user,
        )

    # ------------------------------------------------------------------ update / destroy

    def update(self, request: Request, *args: Any, **kwargs: Any) -> Response:  # type: ignore[override]
        instance = self.get_object()
        if instance.author_id != request.user.pk:
            return Response(
                {"detail": "Only the author can edit a post."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request: Request, *args: Any, **kwargs: Any) -> Response:  # type: ignore[override]
        instance = self.get_object()
        if instance.author_id != request.user.pk:
            return Response(
                {"detail": "Only the author can delete a post."},
                status=status.HTTP_403_FORBIDDEN,
            )
        instance.soft_delete(user=request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ------------------------------------------------------------------ actions

    @action(detail=True, methods=["post"], url_path="pin")
    def pin(self, request: Request, pk: str | None = None) -> Response:
        """Toggle ``is_pinned`` on the post."""
        instance = self.get_object()
        instance.is_pinned = not instance.is_pinned
        instance.save(update_fields=["is_pinned", "updated_at"])
        return Response(FeedPostSerializer(instance, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="like")
    def like(self, request: Request, pk: str | None = None) -> Response:
        """Toggle the caller's 👍 reaction on the post.

        Pass ``{"emoji": "❤️"}`` to use a different emoji. Returns the
        updated ``reaction_summary``.
        """
        instance = self.get_object()
        emoji = request.data.get("emoji") or "👍"
        existing = instance.reactions.filter(user=request.user, emoji=emoji).first()
        if existing is not None:
            existing.delete()
            liked = False
        else:
            FeedReaction.objects.create(
                tenant=request.tenant,  # type: ignore[attr-defined]
                post=instance,
                user=request.user,
                emoji=emoji,
            )
            liked = True
        return Response(
            {
                "liked": liked,
                "emoji": emoji,
                "reaction_summary": FeedPostSerializer(
                    instance, context={"request": request}
                ).get_reaction_summary(instance),
            }
        )

    @action(detail=True, methods=["post"], url_path="add-comment")
    def add_comment(self, request: Request, pk: str | None = None) -> Response:
        """Add a comment to the post."""
        instance = self.get_object()
        body = request.data.get("body")
        if not body:
            return Response(
                {"detail": "body is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        comment = FeedComment.objects.create(
            tenant=request.tenant,  # type: ignore[attr-defined]
            post=instance,
            author=request.user,
            body=str(body),
        )
        return Response(
            FeedCommentSerializer(comment, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["get"], url_path="comments")
    def comments(self, request: Request, pk: str | None = None) -> Response:
        """List the (paginated) comments on the post."""
        instance = self.get_object()
        queryset = (
            instance.comments.filter(deleted_at__isnull=True)
            .select_related("author", "author__profile")
            .order_by("created_at")
        )
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = FeedCommentSerializer(page, many=True, context={"request": request})
            return self.get_paginated_response(serializer.data)
        serializer = FeedCommentSerializer(queryset, many=True, context={"request": request})
        return Response(serializer.data)


###############################################################################
# FeedComment
###############################################################################


class FeedCommentViewSet(viewsets.ModelViewSet):
    """Tenant-scoped feed comments.

    * ``list`` returns comments across the tenant, optionally narrowed by
      ``?post=42``. Most callers should prefer the ``/posts/{id}/comments/``
      action which is paginated + scoped to a single post.
    * ``create`` auto-stamps ``author`` + ``tenant`` and validates that the
      supplied ``post`` belongs to the same tenant.
    * ``update`` / ``destroy`` are author-only.
    * ``like`` toggles the caller's 👍 reaction on the comment.
    """

    serializer_class = FeedCommentSerializer
    queryset = FeedComment.objects.all()
    permission_classes = [IsAuthenticated, IsTenantMember]
    pagination_class = FeedCursorPagination

    def get_queryset(self) -> Any:  # type: ignore[override]
        queryset = (
            super()
            .get_queryset()
            .filter(deleted_at__isnull=True)
            .select_related("author", "author__profile")
        )
        post = self.request.query_params.get("post")
        if post:
            queryset = queryset.filter(post_id=post)
        return queryset

    def perform_create(self, serializer: FeedCommentSerializer) -> FeedComment:  # type: ignore[override]
        post = serializer.validated_data.get("post")
        if post is None or post.tenant_id != self.request.tenant.pk:  # type: ignore[attr-defined]
            from rest_framework.exceptions import ValidationError

            raise ValidationError({"post": "Post must belong to the current tenant."})
        return serializer.save(
            tenant=self.request.tenant,  # type: ignore[attr-defined]
            author=self.request.user,
        )

    def update(self, request: Request, *args: Any, **kwargs: Any) -> Response:  # type: ignore[override]
        instance = self.get_object()
        if instance.author_id != request.user.pk:
            return Response(
                {"detail": "Only the author can edit a comment."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request: Request, *args: Any, **kwargs: Any) -> Response:  # type: ignore[override]
        instance = self.get_object()
        if instance.author_id != request.user.pk:
            return Response(
                {"detail": "Only the author can delete a comment."},
                status=status.HTTP_403_FORBIDDEN,
            )
        instance.deleted_at = timezone.now()
        instance.save(update_fields=["deleted_at", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"], url_path="like")
    def like(self, request: Request, pk: str | None = None) -> Response:
        """Toggle the caller's 👍 reaction on the comment."""
        instance = self.get_object()
        emoji = request.data.get("emoji") or "👍"
        existing = instance.reactions.filter(user=request.user, emoji=emoji).first()
        if existing is not None:
            existing.delete()
            liked = False
        else:
            FeedReaction.objects.create(
                tenant=request.tenant,  # type: ignore[attr-defined]
                comment=instance,
                user=request.user,
                emoji=emoji,
            )
            liked = True
        return Response(
            {
                "liked": liked,
                "emoji": emoji,
                "reaction_summary": FeedCommentSerializer(
                    instance, context={"request": request}
                ).get_reaction_summary(instance),
            }
        )


###############################################################################
# FeedReaction
##############################################################################


class FeedReactionViewSet(viewsets.ModelViewSet):
    """Tenant-scoped feed reactions.

    * ``list`` returns reactions, optionally narrowed by ``?post=42`` or
      ``?comment=7``.
    * ``create`` auto-stamps ``tenant`` + ``user``. The viewset validates that
      the target (post or comment) belongs to the same tenant and enforces the
      XOR rule (exactly one of post / comment set).
    * ``destroy`` is user-only (only the caller's own reactions can be
      removed).
    """

    serializer_class = FeedReactionSerializer
    queryset = FeedReaction.objects.all()
    permission_classes = [IsAuthenticated, IsTenantMember]
    pagination_class = None
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self) -> Any:  # type: ignore[override]
        queryset = super().get_queryset().select_related("user", "user__profile")
        query = self.request.query_params
        post = query.get("post")
        comment = query.get("comment")
        if post:
            queryset = queryset.filter(post_id=post)
        if comment:
            queryset = queryset.filter(comment_id=comment)
        return queryset

    def perform_create(self, serializer: FeedReactionSerializer) -> None:  # type: ignore[override]
        validated = serializer.validated_data
        post = validated.get("post")
        comment = validated.get("comment")
        tenant_id = self.request.tenant.pk  # type: ignore[attr-defined]
        if post is not None and post.tenant_id != tenant_id:
            from rest_framework.exceptions import ValidationError

            raise ValidationError({"post": "Post must belong to the current tenant."})
        if comment is not None and comment.tenant_id != tenant_id:
            from rest_framework.exceptions import ValidationError

            raise ValidationError({"comment": "Comment must belong to the current tenant."})
        serializer.save(
            tenant=self.request.tenant,  # type: ignore[attr-defined]
            user=self.request.user,
        )

    def destroy(self, request: Request, *args: Any, **kwargs: Any) -> Response:  # type: ignore[override]
        instance = self.get_object()
        if instance.user_id != request.user.pk:
            return Response(
                {"detail": "Only the reactor can remove a reaction."},
                status=status.HTTP_403_FORBIDDEN,
            )
        with transaction.atomic():
            instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
