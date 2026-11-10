"""Django app config for the accounts module."""

from django.apps import AppConfig


class AccountsConfig(AppConfig):
    name = "accounts"
    default_auto_field = "django.db.models.BigAutoField"
    verbose_name = "Accounts"
