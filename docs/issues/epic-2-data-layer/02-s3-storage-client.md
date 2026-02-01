# [Feature] S3-compatible storage client

**Labels**: `feature`, `data-layer`, `effort-m`

**Part of**: [Epic] Enterprise Data Layer (#2.0)

---

## Summary

Implement an S3-compatible storage client as a drop-in replacement for `LocalStorageClient`, enabling scalable element storage for multi-node deployments.

## Context

The current `LocalStorageClient` stores elements on the local filesystem, which doesn't work for horizontally-scaled deployments.

**Current Implementation** (`src/datalayer/local_storage.py`):
```python
class LocalStorageClient(BaseStorageClient):
    """Storage client that persists element content to local files."""

    def __init__(self, storage_dir: str = "public/storage"):
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)

    async def upload_file(self, object_key, data, mime, overwrite, ...):
        file_path = self._get_file_path(object_key)
        async with aiofiles.open(file_path, mode) as f:
            await f.write(data)
        return {"object_key": object_key, "url": f"/public/storage/{...}"}
```

**BaseStorageClient Interface** (`chainlit.data.storage_clients.base`):
- `upload_file(object_key, data, mime, overwrite, content_disposition)` → Dict
- `delete_file(object_key)` → bool
- `get_read_url(object_key)` → str
- `close()` → None

## Problem Statement

Local storage limitations:

1. **Single-node only** - Files not shared across instances
2. **No redundancy** - Data lost if disk fails
3. **Storage limits** - Constrained by local disk size
4. **No CDN integration** - Slow delivery for geographically distributed users

## Proposed Solution

### 1. Create S3 Storage Client

```python
# src/datalayer/s3_storage.py

import os
from typing import Any, Dict, Union

import aioboto3
from botocore.config import Config

from chainlit.data.storage_clients.base import BaseStorageClient
from chainlit.logger import logger


class S3StorageClient(BaseStorageClient):
    """
    S3-compatible storage client for Chainlit elements.

    Supports AWS S3, MinIO, DigitalOcean Spaces, and other S3-compatible services.
    """

    def __init__(
        self,
        bucket: str,
        prefix: str = "elements",
        region: str = None,
        endpoint_url: str = None,
        access_key_id: str = None,
        secret_access_key: str = None,
        presigned_url_expiry: int = 3600,  # 1 hour
    ):
        """
        Initialize S3 storage client.

        Args:
            bucket: S3 bucket name
            prefix: Key prefix for all objects (default: "elements")
            region: AWS region (optional, uses default if not specified)
            endpoint_url: Custom endpoint for S3-compatible services (e.g., MinIO)
            access_key_id: AWS access key (optional, uses env/IAM if not specified)
            secret_access_key: AWS secret key (optional, uses env/IAM if not specified)
            presigned_url_expiry: Expiry time for presigned URLs in seconds
        """
        self.bucket = bucket
        self.prefix = prefix.strip("/")
        self.presigned_url_expiry = presigned_url_expiry

        # Build boto3 config
        self.session = aioboto3.Session(
            aws_access_key_id=access_key_id or os.getenv("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=secret_access_key or os.getenv("AWS_SECRET_ACCESS_KEY"),
            region_name=region or os.getenv("AWS_REGION", "us-east-1"),
        )

        self.endpoint_url = endpoint_url or os.getenv("S3_ENDPOINT_URL")

        # Retry config for resilience
        self.config = Config(
            retries={"max_attempts": 3, "mode": "adaptive"},
            connect_timeout=5,
            read_timeout=30,
        )

        logger.info(
            "S3StorageClient initialized: bucket=%s, prefix=%s, endpoint=%s",
            bucket, prefix, self.endpoint_url
        )

    def _get_key(self, object_key: str) -> str:
        """Build full S3 key with prefix."""
        # Sanitize key
        clean_key = object_key.lstrip("/")
        return f"{self.prefix}/{clean_key}" if self.prefix else clean_key

    async def upload_file(
        self,
        object_key: str,
        data: Union[bytes, str],
        mime: str = "application/octet-stream",
        overwrite: bool = True,
        content_disposition: str | None = None,
    ) -> Dict[str, Any]:
        """
        Upload content to S3.

        Args:
            object_key: Unique identifier for the file
            data: File content as bytes or string
            mime: MIME type of the content
            overwrite: Whether to overwrite existing objects
            content_disposition: Content-Disposition header value

        Returns:
            Dict with object_key and presigned URL
        """
        key = self._get_key(object_key)

        try:
            # Check if exists and overwrite is False
            if not overwrite:
                async with self.session.client(
                    "s3",
                    endpoint_url=self.endpoint_url,
                    config=self.config
                ) as s3:
                    try:
                        await s3.head_object(Bucket=self.bucket, Key=key)
                        # Object exists, return existing URL
                        url = await self.get_read_url(object_key)
                        return {"object_key": object_key, "url": url}
                    except s3.exceptions.ClientError as e:
                        if e.response["Error"]["Code"] != "404":
                            raise

            # Convert string to bytes
            if isinstance(data, str):
                data = data.encode("utf-8")

            # Build extra args
            extra_args = {"ContentType": mime}
            if content_disposition:
                extra_args["ContentDisposition"] = content_disposition

            async with self.session.client(
                "s3",
                endpoint_url=self.endpoint_url,
                config=self.config
            ) as s3:
                await s3.put_object(
                    Bucket=self.bucket,
                    Key=key,
                    Body=data,
                    **extra_args,
                )

            url = await self.get_read_url(object_key)
            logger.debug("S3StorageClient: Uploaded %s to %s", object_key, key)
            return {"object_key": object_key, "url": url}

        except Exception as e:
            logger.error("S3StorageClient upload error: %s", e)
            return {}

    async def delete_file(self, object_key: str) -> bool:
        """
        Delete an object from S3.

        Args:
            object_key: Unique identifier for the file to delete

        Returns:
            True if deleted, False on error
        """
        key = self._get_key(object_key)

        try:
            async with self.session.client(
                "s3",
                endpoint_url=self.endpoint_url,
                config=self.config
            ) as s3:
                await s3.delete_object(Bucket=self.bucket, Key=key)
                logger.debug("S3StorageClient: Deleted %s", key)
                return True

        except Exception as e:
            logger.error("S3StorageClient delete error: %s", e)
            return False

    async def get_read_url(self, object_key: str) -> str:
        """
        Generate a presigned URL for reading an object.

        Args:
            object_key: Unique identifier for the file

        Returns:
            Presigned URL valid for presigned_url_expiry seconds
        """
        key = self._get_key(object_key)

        try:
            async with self.session.client(
                "s3",
                endpoint_url=self.endpoint_url,
                config=self.config
            ) as s3:
                url = await s3.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": self.bucket, "Key": key},
                    ExpiresIn=self.presigned_url_expiry,
                )
                return url

        except Exception as e:
            logger.error("S3StorageClient get_read_url error: %s", e)
            # Return a placeholder that will 404 - better than crashing
            return f"s3://{self.bucket}/{key}"

    async def close(self) -> None:
        """Clean up resources (no-op for aioboto3)."""
        pass
```

### 2. Factory Function for Configuration

```python
# src/datalayer/storage.py

import os

from chainlit.data.storage_clients.base import BaseStorageClient

from src.datalayer.local_storage import LocalStorageClient


def get_storage_client() -> BaseStorageClient:
    """
    Factory function to get the appropriate storage client.

    Environment Variables:
        STORAGE_TYPE: "local" (default) or "s3"
        S3_BUCKET: Required if STORAGE_TYPE=s3
        S3_PREFIX: Optional prefix for S3 keys (default: "elements")
        S3_ENDPOINT_URL: Optional custom endpoint (for MinIO, etc.)
        AWS_ACCESS_KEY_ID: AWS credentials (or use IAM role)
        AWS_SECRET_ACCESS_KEY: AWS credentials
        AWS_REGION: AWS region (default: us-east-1)

    Returns:
        Configured storage client
    """
    storage_type = os.getenv("STORAGE_TYPE", "local").lower()

    if storage_type == "s3":
        from src.datalayer.s3_storage import S3StorageClient

        bucket = os.getenv("S3_BUCKET")
        if not bucket:
            raise ValueError("S3_BUCKET environment variable required for S3 storage")

        return S3StorageClient(
            bucket=bucket,
            prefix=os.getenv("S3_PREFIX", "elements"),
            endpoint_url=os.getenv("S3_ENDPOINT_URL"),
        )

    elif storage_type == "local":
        return LocalStorageClient(
            storage_dir=os.getenv("LOCAL_STORAGE_DIR", "public/storage")
        )

    else:
        raise ValueError(f"Unknown STORAGE_TYPE: {storage_type}")
```

### 3. Update Data Layer to Use Factory

```python
# src/datalayer/postgres.py

from src.datalayer.storage import get_storage_client

def get_data_layer() -> CustomSQLAlchemyDataLayer:
    conninfo = os.environ.get(
        "DATABASE_URL",
        "postgresql+asyncpg://chainlit:chainlit_password@localhost:5432/chainlit_db",
    )

    # Use storage factory instead of hardcoded LocalStorageClient
    storage_provider = get_storage_client()

    return CustomSQLAlchemyDataLayer(
        conninfo=conninfo,
        ssl_require=False,
        storage_provider=storage_provider,
    )
```

## Technical Details

### Files to Create/Modify

| File | Changes |
|------|---------|
| `src/datalayer/s3_storage.py` | New: S3 storage client |
| `src/datalayer/storage.py` | New: Storage factory function |
| `src/datalayer/postgres.py` | Use storage factory |
| `src/datalayer/__init__.py` | Export new classes |
| `pyproject.toml` | Add `aioboto3` dependency |

### Dependencies

Add to `pyproject.toml`:
```toml
dependencies = [
    # ... existing ...
    "aioboto3>=12.0.0",
]
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `STORAGE_TYPE` | No | `local` | `local` or `s3` |
| `S3_BUCKET` | If S3 | - | S3 bucket name |
| `S3_PREFIX` | No | `elements` | Key prefix in bucket |
| `S3_ENDPOINT_URL` | No | - | Custom endpoint (MinIO, etc.) |
| `AWS_ACCESS_KEY_ID` | If S3* | - | AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | If S3* | - | AWS credentials |
| `AWS_REGION` | No | `us-east-1` | AWS region |

*Can also use IAM role/instance profile

### MinIO Configuration Example

For local development with MinIO:

```bash
# docker-compose.yml
services:
  minio:
    image: minio/minio
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    command: server /data --console-address ":9001"

# .env
STORAGE_TYPE=s3
S3_BUCKET=chainlit-elements
S3_ENDPOINT_URL=http://localhost:9000
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
```

### Presigned URL Security

- URLs expire after 1 hour by default (configurable)
- Each `get_read_url` call generates a fresh URL
- Consider caching URLs in production for performance

## Acceptance Criteria

- [ ] `S3StorageClient` implements `BaseStorageClient` interface
- [ ] Upload, delete, and get_read_url work with AWS S3
- [ ] Works with MinIO for local development
- [ ] Factory function selects client based on env var
- [ ] Existing local storage continues to work
- [ ] Presigned URLs have configurable expiry
- [ ] Retry logic for transient failures
- [ ] Unit tests with mocked S3
- [ ] Integration tests with MinIO

## Testing Strategy

### Unit Tests (Mocked)
```python
@pytest.fixture
def s3_client():
    with mock_s3():
        client = S3StorageClient(bucket="test-bucket")
        yield client

async def test_upload_creates_object(s3_client):
    result = await s3_client.upload_file(
        "test.txt",
        b"hello world",
        mime="text/plain"
    )
    assert result["object_key"] == "test.txt"
    assert "url" in result

async def test_delete_removes_object(s3_client):
    await s3_client.upload_file("test.txt", b"data")
    result = await s3_client.delete_file("test.txt")
    assert result is True

async def test_presigned_url_generated(s3_client):
    await s3_client.upload_file("test.txt", b"data")
    url = await s3_client.get_read_url("test.txt")
    assert "X-Amz-Signature" in url
```

### Integration Tests (MinIO)
```python
@pytest.mark.integration
async def test_full_lifecycle_with_minio():
    # Requires running MinIO container
    client = S3StorageClient(
        bucket="test-bucket",
        endpoint_url="http://localhost:9000",
        access_key_id="minioadmin",
        secret_access_key="minioadmin",
    )

    # Upload
    result = await client.upload_file("test.txt", b"hello")
    assert result["url"]

    # Read URL
    url = await client.get_read_url("test.txt")
    # Actually fetch the URL to verify it works

    # Delete
    deleted = await client.delete_file("test.txt")
    assert deleted
```

## Dependencies

- Blocked by: None (independent)
- Blocks: None

## Out of Scope

- Server-side encryption configuration
- Cross-region replication
- Lifecycle policies (object expiration)
- Direct upload from browser (presigned POST)
- CDN integration (CloudFront, etc.)
