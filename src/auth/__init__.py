"""Authentication module for Chainlit user identification."""

from src.auth.callbacks import password_auth_callback
from src.auth.inject_custom_auth import add_custom_oauth_provider

__all__ = ["password_auth_callback", "add_custom_oauth_provider"]
