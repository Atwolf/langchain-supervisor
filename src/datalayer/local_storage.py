"""
Local file system storage client for Chainlit elements.

This module provides a BaseStorageClient implementation that stores
element content in local files, served via Chainlit's /public/ endpoint.
"""

import os
import re
from pathlib import Path
from typing import Any, Dict, Union

import aiofiles

from chainlit.data.storage_clients.base import BaseStorageClient
from chainlit.logger import logger


class LocalStorageClient(BaseStorageClient):
    """
    Storage client that persists element content to local files.

    Files are stored in the specified directory (default: public/storage/)
    and served via Chainlit's /public/ static file endpoint.
    """

    def __init__(self, storage_dir: str = "public/storage"):
        """
        Initialize the local storage client.

        Args:
            storage_dir: Directory path for storing files, relative to project root.
                        Must be under public/ to be served by Chainlit.
        """
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        logger.info("LocalStorageClient initialized with storage_dir: %s", self.storage_dir)

    def _sanitize_object_key(self, object_key: str) -> str:
        """
        Sanitize object key to prevent path traversal attacks.

        Args:
            object_key: The raw object key from Chainlit

        Returns:
            Sanitized key safe for filesystem use
        """
        # Remove any path traversal attempts
        sanitized = re.sub(r"\.\.+", "", object_key)
        # Remove leading slashes
        sanitized = sanitized.lstrip("/\\")
        # Replace any remaining problematic characters
        sanitized = re.sub(r"[<>:\"|?*]", "_", sanitized)
        return sanitized

    def _get_file_path(self, object_key: str) -> Path:
        """Get the full filesystem path for an object key."""
        sanitized_key = self._sanitize_object_key(object_key)
        return self.storage_dir / sanitized_key

    async def upload_file(
        self,
        object_key: str,
        data: Union[bytes, str],
        mime: str = "application/octet-stream",
        overwrite: bool = True,
        content_disposition: str | None = None,
    ) -> Dict[str, Any]:
        """
        Write content to a local file.

        Args:
            object_key: Unique identifier for the file
            data: File content as bytes or string
            mime: MIME type (stored but not used for local files)
            overwrite: Whether to overwrite existing files
            content_disposition: Content disposition header (not used for local files)

        Returns:
            Dict with object_key and url for the stored file
        """
        try:
            file_path = self._get_file_path(object_key)

            # Create parent directories if needed
            file_path.parent.mkdir(parents=True, exist_ok=True)

            # Check if file exists and overwrite is False
            if not overwrite and file_path.exists():
                logger.warning("LocalStorageClient: File already exists: %s", object_key)
                url = f"/public/storage/{self._sanitize_object_key(object_key)}"
                return {"object_key": object_key, "url": url}

            # Write content
            mode = "wb" if isinstance(data, bytes) else "w"
            async with aiofiles.open(file_path, mode) as f:
                await f.write(data)

            url = f"/public/storage/{self._sanitize_object_key(object_key)}"
            logger.debug("LocalStorageClient: Uploaded file to %s", file_path)
            return {"object_key": object_key, "url": url}

        except Exception as e:
            logger.warning("LocalStorageClient, upload_file error: %s", e)
            return {}

    async def delete_file(self, object_key: str) -> bool:
        """
        Remove a file from storage.

        Args:
            object_key: Unique identifier for the file to delete

        Returns:
            True if file was deleted, False otherwise
        """
        try:
            file_path = self._get_file_path(object_key)
            if file_path.exists():
                os.remove(file_path)
                logger.debug("LocalStorageClient: Deleted file %s", file_path)
                return True
            return False
        except Exception as e:
            logger.warning("LocalStorageClient, delete_file error: %s", e)
            return False

    async def get_read_url(self, object_key: str) -> str:
        """
        Get the URL for reading a stored file.

        Args:
            object_key: Unique identifier for the file

        Returns:
            URL path served by Chainlit's /public/ endpoint
        """
        return f"/public/storage/{self._sanitize_object_key(object_key)}"

    async def close(self) -> None:
        """No-op for local storage - no connections to close."""
