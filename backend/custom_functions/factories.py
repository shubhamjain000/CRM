"""factory_boy factories for the custom_functions app."""

from __future__ import annotations

import factory
from factory.django import DjangoModelFactory

from api.factories import _current_tenant, _current_user
from custom_functions.models import (
    CustomFunction,
    CustomFunctionExecution,
    CustomFunctionVariable,
    CustomFunctionVersion,
    HttpAllowlist,
    HttpCallLog,
    KVStore,
    LANGUAGE_PYTHON,
    STATUS_COMPLETED,
    TRIGGER_MANUAL,
)


class CustomFunctionFactory(DjangoModelFactory):
    """Factory for :class:`CustomFunction`.

    Defaults: ``language=python``, ``trigger_event=manual``, ``is_active=True``,
    ``is_approved=False``, ``code="return input_data"``.
    """

    class Meta:
        model = CustomFunction

    tenant = factory.LazyFunction(_current_tenant)
    name = factory.Sequence(lambda n: f"Custom Function {n}")
    description = ""
    language = LANGUAGE_PYTHON
    trigger_event = TRIGGER_MANUAL
    code = "return input_data"
    version = 1
    is_active = True
    is_approved = False
    created_by = factory.LazyFunction(_current_user)


class CustomFunctionVariableFactory(DjangoModelFactory):
    """Factory for :class:`CustomFunctionVariable`."""

    class Meta:
        model = CustomFunctionVariable

    tenant = factory.LazyFunction(_current_tenant)
    function = factory.SubFactory(CustomFunctionFactory)
    name = factory.Sequence(lambda n: f"var_{n}")
    var_type = "input"
    data_type = "string"
    description = ""
    default_value = ""
    is_required = False


class CustomFunctionExecutionFactory(DjangoModelFactory):
    """Factory for :class:`CustomFunctionExecution`."""

    class Meta:
        model = CustomFunctionExecution

    tenant = factory.LazyFunction(_current_tenant)
    function = factory.SubFactory(CustomFunctionFactory)
    trigger = TRIGGER_MANUAL
    input_data = factory.LazyFunction(lambda: {})
    output_data = None
    status = STATUS_COMPLETED
    log_output = ""
    execution_time_ms = 10


class CustomFunctionVersionFactory(DjangoModelFactory):
    """Factory for :class:`CustomFunctionVersion`."""

    class Meta:
        model = CustomFunctionVersion

    tenant = factory.LazyFunction(_current_tenant)
    function = factory.SubFactory(CustomFunctionFactory)
    version = factory.Sequence(lambda n: n + 1)
    code = "return input_data"
    created_by = factory.LazyFunction(_current_user)


class HttpAllowlistFactory(DjangoModelFactory):
    """Factory for :class:`HttpAllowlist`."""

    class Meta:
        model = HttpAllowlist

    tenant = factory.LazyFunction(_current_tenant)
    domain = factory.Sequence(lambda n: f"example-{n}.com")
    is_active = True


class HttpCallLogFactory(DjangoModelFactory):
    """Factory for :class:`HttpCallLog`."""

    class Meta:
        model = HttpCallLog

    tenant = factory.LazyFunction(_current_tenant)
    function_execution = factory.SubFactory(CustomFunctionExecutionFactory)
    url = "https://example.com/api"
    method = "GET"
    status_code = 200
    request_body_size = 0
    response_body_size = 1024


class KVStoreFactory(DjangoModelFactory):
    """Factory for :class:`KVStore`."""

    class Meta:
        model = KVStore

    tenant = factory.LazyFunction(_current_tenant)
    key = factory.Sequence(lambda n: f"key_{n}")
    value = "value"


__all__ = [
    "CustomFunctionExecutionFactory",
    "CustomFunctionFactory",
    "CustomFunctionVariableFactory",
    "CustomFunctionVersionFactory",
    "HttpAllowlistFactory",
    "HttpCallLogFactory",
    "KVStoreFactory",
]
