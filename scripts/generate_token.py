#!/usr/bin/env python3
"""
Generate a JWT token for Chainlit copilot widget authentication.

Usage:
    uv run python scripts/generate_token.py [identifier] [name]

Example:
    uv run python scripts/generate_token.py dev-user "Developer"
"""

import os
import sys
from datetime import datetime, timedelta, timezone

import jwt
from dotenv import load_dotenv

load_dotenv()


def create_jwt(identifier: str, metadata: dict, days_valid: int = 15) -> str:
    """Create a JWT token for Chainlit copilot authentication."""
    secret = os.environ.get("CHAINLIT_AUTH_SECRET")
    if not secret:
        raise ValueError("CHAINLIT_AUTH_SECRET not set in environment")

    payload = {
        "identifier": identifier,
        "metadata": metadata,
        "exp": datetime.now(timezone.utc) + timedelta(days=days_valid),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def main():
    identifier = sys.argv[1] if len(sys.argv) > 1 else "anonymous"
    name = sys.argv[2] if len(sys.argv) > 2 else "Anonymous User"

    token = create_jwt(identifier, {"name": name})

    print(f"\nGenerated JWT Token for: {identifier}")
    print(f"Valid for: 15 days")
    print(f"\nToken:\n{token}")
    print(f"\nUse this in your website's mountChainlitWidget config:")
    print(f'  accessToken: "{token}"')


if __name__ == "__main__":
    main()
