"""Django app config for the leads module."""

from django.apps import AppConfig


class LeadsConfig(AppConfig):
    name = "leads"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Leads"
