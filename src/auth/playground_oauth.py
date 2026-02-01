"""
Custom OAuth provider for oauth.com playground.

This provider enables OAuth authentication using the oauth.com
playground server for testing OAuth flows.
"""

import os
from typing import Dict, Tuple

import httpx
from chainlit.oauth_providers import OAuthProvider
from chainlit.user import User


class PlaygroundOAuthProvider(OAuthProvider):
    """OAuth provider for oauth.com playground testing server."""

    id = "playground"
    env = ["OAUTH_PLAYGROUND_CLIENT_ID", "OAUTH_PLAYGROUND_CLIENT_SECRET"]
    authorize_url = "https://authorization-server.com/authorize"
    token_url = "https://authorization-server.com/token"

    def __init__(self):
        self.client_id = os.environ.get("OAUTH_PLAYGROUND_CLIENT_ID")
        self.client_secret = os.environ.get("OAUTH_PLAYGROUND_CLIENT_SECRET")
        self.authorize_params = {
            "scope": "photo offline_access",
            "response_type": "code",
        }

    async def get_raw_token_response(self, code: str, url: str) -> Dict:
        """
        Exchange authorization code for token response.

        Args:
            code: The authorization code from the OAuth callback
            url: The redirect URI used in the authorization request

        Returns:
            The full token response as a dictionary
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.token_url,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": url,
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            response.raise_for_status()
            return response.json()

    async def get_token(self, code: str, url: str) -> str:
        """
        Exchange authorization code for access token.

        Args:
            code: The authorization code from the OAuth callback
            url: The redirect URI used in the authorization request

        Returns:
            The access token string
        """
        token_data = await self.get_raw_token_response(code, url)
        return token_data.get("access_token", "")

    async def get_user_info(self, token: str) -> Tuple[Dict[str, str], User]:
        """
        Get user information from the OAuth provider.

        The oauth.com playground doesn't have a real userinfo endpoint,
        so we create a user based on the token or use placeholder info.

        Args:
            token: The access token

        Returns:
            Tuple of (raw_user_data dict, User object)
        """
        # The playground server may not have a userinfo endpoint
        # We'll use the token to create a unique user identifier
        # In a real scenario, you would call a userinfo endpoint here

        # Create user info based on the token
        # Using a hash of the token as identifier for uniqueness
        user_id = f"playground_user_{hash(token) % 100000}"

        raw_user_data = {
            "id": user_id,
            "name": "Playground User",
            "email": "playground@example.com",
            "provider": "playground",
        }

        user = User(
            identifier=user_id,
            metadata={
                "name": raw_user_data["name"],
                "email": raw_user_data["email"],
                "provider": "playground",
                "role": "user",
            },
        )

        return raw_user_data, user
