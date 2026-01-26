"""
PostgreSQL Data Layer Configuration for Chainlit.

This module configures the SQLAlchemy data layer for persistent
chat threads, user data, and feedback storage.
"""

import json
import os
from typing import TYPE_CHECKING

from chainlit.data.sql_alchemy import SQLAlchemyDataLayer

from src.datalayer.local_storage import LocalStorageClient

if TYPE_CHECKING:
    from chainlit.types import StepDict


class CustomSQLAlchemyDataLayer(SQLAlchemyDataLayer):
    """
    Custom data layer that fixes JSONB serialization for the 'modes' field.

    The base SQLAlchemyDataLayer serializes 'metadata' and 'generation' fields
    but not 'modes', causing asyncpg errors when inserting steps with modes.
    """

    async def create_step(self, step_dict: "StepDict"):
        """Override to properly serialize the 'modes' field as JSON."""
        # Serialize modes to JSON string if present
        if "modes" in step_dict and step_dict["modes"] is not None:
            step_dict["modes"] = json.dumps(step_dict["modes"])

        # Call parent implementation
        await super().create_step(step_dict)


def get_data_layer() -> CustomSQLAlchemyDataLayer:
    """
    Create and return the SQLAlchemy data layer instance.

    Connection string format: postgresql+asyncpg://user:password@host:port/dbname
    The +asyncpg suffix is required for async operations.

    Environment Variables:
        DATABASE_URL: PostgreSQL connection string (required)

    Returns:
        CustomSQLAlchemyDataLayer configured for PostgreSQL with local file storage
    """
    conninfo = os.environ.get(
        "DATABASE_URL",
        "postgresql+asyncpg://chainlit:chainlit_password@localhost:5432/chainlit_db",
    )

    # Create local storage provider for element content
    storage_provider = LocalStorageClient(storage_dir="public/storage")

    return CustomSQLAlchemyDataLayer(
        conninfo=conninfo,
        ssl_require=False,  # Set True for production with SSL
        storage_provider=storage_provider,
    )
