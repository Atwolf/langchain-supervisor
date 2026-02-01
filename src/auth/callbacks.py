"""
Authentication callbacks for Chainlit.

Provides user identification for thread persistence.
These callbacks are auto-registered when imported.
"""

import os
from typing import Optional

import chainlit as cl


@cl.password_auth_callback
def password_auth_callback(username: str, password: str) -> Optional[cl.User]:
    """
    Password authentication callback for web UI login.

    In development mode (CHAINLIT_DEV_AUTH=true), accepts any non-empty credentials.
    In production, verifies against configured admin credentials.

    Args:
        username: The username entered by the user
        password: The password entered by the user

    Returns:
        cl.User object if authentication succeeds, None otherwise
    """
    # Development mode: accept any non-empty credentials
    if os.environ.get("CHAINLIT_DEV_AUTH", "false").lower() == "true":
        if username and password:
            return cl.User(
                identifier=username,
                metadata={"role": "user", "provider": "credentials"},
            )

    # Production: verify against configured credentials
    admin_user = os.environ.get("ADMIN_USERNAME", "admin")
    admin_pass = os.environ.get("ADMIN_PASSWORD", "admin")

    if username == admin_user and password == admin_pass:
        return cl.User(
            identifier=username,
            metadata={"role": "admin", "provider": "credentials"},
        )

    return None
