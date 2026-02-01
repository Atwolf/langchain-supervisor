# [Feature] Audit logging for data layer mutations

**Labels**: `feature`, `data-layer`, `effort-m`, `good-first-issue`

**Part of**: [Epic] Enterprise Data Layer (#2.0)

---

## Summary

Add comprehensive audit logging to the data layer, capturing all mutations (create, update, delete) with user context for compliance and debugging.

## Context

The `CustomSQLAlchemyDataLayer` wraps Chainlit's data layer but doesn't track changes.

**Current Implementation** (`src/datalayer/postgres.py:20-35`):
```python
class CustomSQLAlchemyDataLayer(SQLAlchemyDataLayer):
    """Custom data layer that fixes JSONB serialization."""

    async def create_step(self, step_dict: "StepDict"):
        # Only fixes serialization, no audit logging
        if "modes" in step_dict and step_dict["modes"] is not None:
            step_dict["modes"] = json.dumps(step_dict["modes"])
        await super().create_step(step_dict)
```

## Problem Statement

Without audit logging:

1. **Compliance gaps** - Can't prove who accessed/modified data
2. **Debugging blind spots** - Can't trace data corruption sources
3. **Security incidents** - No forensic trail for investigations
4. **Support friction** - Can't answer "what happened to my thread?"

## Proposed Solution

### 1. Create Audit Log Schema

```sql
-- datalayer/database/init/02-audit-log.sql

CREATE TABLE IF NOT EXISTS audit_log (
    "id" BIGSERIAL PRIMARY KEY,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "table_name" TEXT NOT NULL,
    "record_id" UUID NOT NULL,
    "operation" TEXT NOT NULL,  -- INSERT, UPDATE, DELETE
    "user_id" UUID,
    "user_identifier" TEXT,
    "old_values" JSONB,
    "new_values" JSONB,
    "metadata" JSONB  -- Additional context (IP, user agent, etc.)
);

-- Indexes for common queries
CREATE INDEX idx_audit_log_timestamp ON audit_log("timestamp" DESC);
CREATE INDEX idx_audit_log_table_record ON audit_log("table_name", "record_id");
CREATE INDEX idx_audit_log_user ON audit_log("user_identifier");

-- Partition by month for retention management (optional)
-- ALTER TABLE audit_log PARTITION BY RANGE ("timestamp");
```

### 2. Create Audit Logger Mixin

```python
# src/datalayer/audit.py

import json
from datetime import datetime
from typing import Any, Dict, Optional
from dataclasses import dataclass

from chainlit.context import context_var
from sqlalchemy import text

@dataclass
class AuditEntry:
    table_name: str
    record_id: str
    operation: str  # INSERT, UPDATE, DELETE
    old_values: Optional[Dict] = None
    new_values: Optional[Dict] = None
    metadata: Optional[Dict] = None

class AuditLoggerMixin:
    """Mixin that adds audit logging to data layer operations."""

    async def _log_audit(self, entry: AuditEntry) -> None:
        """Write an audit log entry."""
        # Get user context from Chainlit
        user_id = None
        user_identifier = None

        ctx = context_var.get()
        if ctx and ctx.session and ctx.session.user:
            user_id = ctx.session.user.id
            user_identifier = ctx.session.user.identifier

        # Add request context to metadata
        metadata = entry.metadata or {}
        if ctx and hasattr(ctx, 'request'):
            metadata['ip_address'] = getattr(ctx.request, 'client_host', None)
            metadata['user_agent'] = getattr(ctx.request, 'headers', {}).get('user-agent')

        query = text("""
            INSERT INTO audit_log
            (table_name, record_id, operation, user_id, user_identifier, old_values, new_values, metadata)
            VALUES
            (:table_name, :record_id, :operation, :user_id, :user_identifier, :old_values, :new_values, :metadata)
        """)

        params = {
            "table_name": entry.table_name,
            "record_id": entry.record_id,
            "operation": entry.operation,
            "user_id": str(user_id) if user_id else None,
            "user_identifier": user_identifier,
            "old_values": json.dumps(entry.old_values) if entry.old_values else None,
            "new_values": json.dumps(entry.new_values) if entry.new_values else None,
            "metadata": json.dumps(metadata) if metadata else None,
        }

        async with self.async_session() as session:
            await session.execute(query, params)
            await session.commit()
```

### 3. Extend Data Layer with Audit Logging

```python
# src/datalayer/postgres.py

from src.datalayer.audit import AuditLoggerMixin, AuditEntry

class CustomSQLAlchemyDataLayer(AuditLoggerMixin, SQLAlchemyDataLayer):
    """Data layer with JSONB fixes and audit logging."""

    async def create_step(self, step_dict: "StepDict"):
        """Create step with audit logging."""
        # Fix JSONB serialization
        if "modes" in step_dict and step_dict["modes"] is not None:
            step_dict["modes"] = json.dumps(step_dict["modes"])

        # Call parent to create the step
        await super().create_step(step_dict)

        # Log the creation
        await self._log_audit(AuditEntry(
            table_name="steps",
            record_id=step_dict["id"],
            operation="INSERT",
            new_values=self._sanitize_for_audit(step_dict),
        ))

    async def delete_thread(self, thread_id: str):
        """Delete thread with audit logging."""
        # Get thread data before deletion
        thread = await self.get_thread(thread_id)
        old_values = thread.__dict__ if thread else None

        await super().delete_thread(thread_id)

        await self._log_audit(AuditEntry(
            table_name="threads",
            record_id=thread_id,
            operation="DELETE",
            old_values=old_values,
        ))

    async def update_thread(
        self,
        thread_id: str,
        name: str = None,
        user_id: str = None,
        metadata: Dict = None,
        tags: list = None,
    ):
        """Update thread with audit logging."""
        # Get current state
        old_thread = await self.get_thread(thread_id)
        old_values = old_thread.__dict__ if old_thread else None

        await super().update_thread(thread_id, name, user_id, metadata, tags)

        new_values = {
            "name": name,
            "user_id": user_id,
            "metadata": metadata,
            "tags": tags,
        }

        await self._log_audit(AuditEntry(
            table_name="threads",
            record_id=thread_id,
            operation="UPDATE",
            old_values=old_values,
            new_values={k: v for k, v in new_values.items() if v is not None},
        ))

    async def upsert_feedback(self, feedback):
        """Record feedback with audit logging."""
        # Check if this is an update
        existing = await self._get_feedback(feedback.id)

        await super().upsert_feedback(feedback)

        await self._log_audit(AuditEntry(
            table_name="feedbacks",
            record_id=str(feedback.id),
            operation="UPDATE" if existing else "INSERT",
            old_values=existing.__dict__ if existing else None,
            new_values=feedback.__dict__,
        ))

    def _sanitize_for_audit(self, data: Dict) -> Dict:
        """Remove sensitive fields from audit data."""
        sensitive_keys = {'password', 'token', 'secret', 'api_key', 'credential'}
        return {
            k: '[REDACTED]' if any(s in k.lower() for s in sensitive_keys) else v
            for k, v in data.items()
        }
```

### 4. Add Audit Query Methods

```python
# src/datalayer/postgres.py (continued)

async def get_audit_log(
    self,
    table_name: str = None,
    record_id: str = None,
    user_identifier: str = None,
    start_time: datetime = None,
    end_time: datetime = None,
    limit: int = 100,
) -> List[Dict]:
    """Query audit log with filters."""
    conditions = []
    params = {"limit": limit}

    if table_name:
        conditions.append("table_name = :table_name")
        params["table_name"] = table_name

    if record_id:
        conditions.append("record_id = :record_id")
        params["record_id"] = record_id

    if user_identifier:
        conditions.append("user_identifier = :user_identifier")
        params["user_identifier"] = user_identifier

    if start_time:
        conditions.append("timestamp >= :start_time")
        params["start_time"] = start_time

    if end_time:
        conditions.append("timestamp < :end_time")
        params["end_time"] = end_time

    where_clause = " AND ".join(conditions) if conditions else "1=1"

    query = text(f"""
        SELECT * FROM audit_log
        WHERE {where_clause}
        ORDER BY timestamp DESC
        LIMIT :limit
    """)

    async with self.async_session() as session:
        result = await session.execute(query, params)
        return [dict(row._mapping) for row in result.fetchall()]
```

## Technical Details

### Files to Create/Modify

| File | Changes |
|------|---------|
| `datalayer/database/init/02-audit-log.sql` | New: Audit log schema |
| `src/datalayer/audit.py` | New: Audit logger mixin |
| `src/datalayer/postgres.py` | Add audit logging to mutations |

### Audit Log Schema

| Column | Type | Description |
|--------|------|-------------|
| `id` | BIGSERIAL | Auto-increment primary key |
| `timestamp` | TIMESTAMPTZ | When the change occurred |
| `table_name` | TEXT | Which table was modified |
| `record_id` | UUID | Primary key of modified record |
| `operation` | TEXT | INSERT, UPDATE, or DELETE |
| `user_id` | UUID | Chainlit user ID (nullable) |
| `user_identifier` | TEXT | Username for display |
| `old_values` | JSONB | Previous state (for UPDATE/DELETE) |
| `new_values` | JSONB | New state (for INSERT/UPDATE) |
| `metadata` | JSONB | Additional context |

### Performance Considerations

- Audit logging is async but in same transaction
- Consider background queue for high-volume deployments
- Partition by month for retention management
- Index on timestamp DESC for recent queries

### Sensitive Data Handling

The `_sanitize_for_audit` method redacts fields containing:
- `password`, `token`, `secret`, `api_key`, `credential`

## Acceptance Criteria

- [ ] Audit log table created with proper indexes
- [ ] All data layer mutations logged (create, update, delete)
- [ ] User context captured from Chainlit session
- [ ] Sensitive fields redacted from audit data
- [ ] Query method supports filtering by table, record, user, time
- [ ] Unit tests for audit logging
- [ ] Integration tests verify logging works end-to-end

## Testing Strategy

### Unit Tests
```python
async def test_audit_log_captures_user_context():
    # Mock Chainlit context with user
    # Create a step
    # Verify audit log contains user info

async def test_audit_log_sanitizes_sensitive_data():
    data = {"name": "test", "api_key": "secret123"}
    sanitized = data_layer._sanitize_for_audit(data)
    assert sanitized["api_key"] == "[REDACTED]"

async def test_audit_query_filters():
    # Create multiple audit entries
    # Query with various filters
    # Verify correct results returned
```

### Integration Tests
- Full flow: create thread → update → delete → query audit log
- Verify old_values and new_values are accurate

## Dependencies

- Blocked by: None (independent)
- Blocks: None

## Out of Scope

- Audit log retention policies (manual deletion for MVP)
- External audit log shipping (e.g., to Splunk)
- Tamper-proof audit logging (blockchain, etc.)
- Real-time audit streaming
