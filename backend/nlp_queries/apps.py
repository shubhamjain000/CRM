"""Django app config for the nlp_queries module."""

from __future__ import annotations

from django.apps import AppConfig


class NLPQueriesConfig(AppConfig):
    """App config for ``nlp_queries``."""

    name = "nlp_queries"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "NLP Queries"
