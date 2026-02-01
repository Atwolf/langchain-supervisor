"""
Helper functions for custom OAuth provider injection.

Following the Chainlit cookbook pattern for safely registering
custom OAuth providers.
"""

import os

from chainlit.oauth_providers import providers, OAuthProvider


def custom_oauth_enabled() -> bool:
    """Check if all required OAuth environment variables are set."""
    required_vars = [
        "OAUTH_PLAYGROUND_CLIENT_ID",
        "OAUTH_PLAYGROUND_CLIENT_SECRET",
    ]
    return all(os.environ.get(var) for var in required_vars)


def provider_id_in_instance_list(provider_id: str) -> bool:
    """Check if a provider is already registered."""
    return any(p.id == provider_id for p in providers)


def add_custom_oauth_provider(provider_id: str, provider: OAuthProvider) -> bool:
    """
    Safely add a custom OAuth provider if not already registered.

    Args:
        provider_id: The unique identifier for the provider
        provider: The OAuthProvider instance to register

    Returns:
        True if provider was added, False otherwise.
    """
    if not custom_oauth_enabled():
        return False
    if provider_id_in_instance_list(provider_id):
        return False
    providers.append(provider)
    return True
