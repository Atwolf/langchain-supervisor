"""
PostgreSQL Data Layer Configuration for Chainlit.

This module configures the SQLAlchemy data layer for persistent
chat threads, user data, and feedback storage, with subagent
feedback association.
"""

import json
import logging
import os
from typing import TYPE_CHECKING

from chainlit.data.sql_alchemy import SQLAlchemyDataLayer
from chainlit.types import Feedback

from src.datalayer.local_storage import LocalStorageClient

if TYPE_CHECKING:
    from chainlit.types import StepDict

logger = logging.getLogger(__name__)


class CustomSQLAlchemyDataLayer(SQLAlchemyDataLayer):
    """
    Custom data layer extending SQLAlchemyDataLayer with:
    - JSONB serialization fix for the 'modes' field
    - Subagent association on feedback records

    When a user submits feedback (thumbs up/down), this layer looks up the
    step's metadata to find which subagent(s) contributed to the response
    and stores that association in the feedbacks table.
    """

    async def create_step(self, step_dict: "StepDict"):
        """Override to properly serialize the 'modes' field as JSON."""
        # Serialize modes to JSON string if present
        if "modes" in step_dict and step_dict["modes"] is not None:
            step_dict["modes"] = json.dumps(step_dict["modes"])

        # Call parent implementation
        await super().create_step(step_dict)

    async def _get_step_subagents(self, step_id: str) -> list[str]:
        """
        Look up the subagents metadata for a given step.

        The on_message handler stores contributing subagent names in the
        step's metadata under the 'subagents' key.
        """
        query = """SELECT "metadata" FROM steps WHERE "id" = :step_id"""
        result = await self.execute_sql(query=query, parameters={"step_id": step_id})
        if not result or not result.data:
            return []

        row = result.data[0]
        metadata = row.get("metadata")
        if not metadata:
            return []

        # metadata may be a JSON string or already a dict
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except (json.JSONDecodeError, TypeError):
                return []

        return metadata.get("subagents", [])

    async def upsert_feedback(self, feedback: Feedback) -> str:
        """
        Override to associate feedback with contributing subagent(s).

        After creating the standard feedback record, looks up the step
        that the feedback targets and writes the subagent names from
        the step's metadata into the feedback's subagents column.
        """
        # Create the feedback record via parent implementation
        feedback_id = await super().upsert_feedback(feedback)

        # Look up subagents from the step this feedback is for
        try:
            subagents = await self._get_step_subagents(feedback.forId)
            if subagents:
                await self.execute_sql(
                    query=(
                        'UPDATE feedbacks SET "subagents" = :subagents'
                        ' WHERE "id" = :feedback_id'
                    ),
                    parameters={
                        "subagents": subagents,
                        "feedback_id": feedback_id,
                    },
                )
                logger.info(
                    "Feedback %s associated with subagents: %s",
                    feedback_id,
                    subagents,
                )
        except Exception:
            # Don't fail the feedback operation if subagent lookup fails
            logger.warning(
                "Failed to associate subagents with feedback %s",
                feedback_id,
                exc_info=True,
            )

        return feedback_id


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
