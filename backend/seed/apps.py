"""Django app config for the seed module."""

from django.apps import AppConfig


class SeedConfig(AppConfig):
    name = "seed"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Seed"
