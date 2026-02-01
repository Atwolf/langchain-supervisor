# [Feature] Query API for agent metrics and feedback attribution

**Labels**: `feature`, `observability`, `effort-m`

**Part of**: [Epic] Agent Observability (#1.0)

---

## Summary

Build a query API layer for retrieving agent performance metrics, token usage aggregates, and feedback attribution reports.

## Context

With agent attribution (#1.1) and token tracking (#1.2) in place, we need an API to query this data for dashboards and reports.

**Existing Data Layer** (`src/datalayer/postgres.py`):
```python
class CustomSQLAlchemyDataLayer(SQLAlchemyDataLayer):
    """Custom data layer that fixes JSONB serialization."""

    async def create_step(self, step_dict: "StepDict"):
        # ... serialization fix ...
        await super().create_step(step_dict)
```

**Current Schema** (`datalayer/database/init/01-schema.sql`):
- `steps` table with `metadata` and `generation` JSONB
- `feedbacks` table with `forId` linking to steps

## Problem Statement

While data is stored, there's no way to:

1. Query agent performance trends
2. Get feedback attribution (which agent received thumbs down)
3. Generate cost reports by agent
4. Export metrics for external dashboards

## Proposed Solution

### 1. Extend Data Layer with Query Methods

Add query methods to `CustomSQLAlchemyDataLayer`:

```python
# src/datalayer/postgres.py

from datetime import datetime
from typing import List, Optional
from dataclasses import dataclass

@dataclass
class AgentMetrics:
    agent_name: str
    total_calls: int
    total_input_tokens: int
    total_output_tokens: int
    total_cost_usd: float
    avg_latency_ms: float
    error_rate: float

@dataclass
class FeedbackSummary:
    agent_name: str
    thumbs_up: int
    thumbs_down: int
    sentiment_score: float  # -1 to 1
    sample_comments: List[str]

class CustomSQLAlchemyDataLayer(SQLAlchemyDataLayer):
    # ... existing methods ...

    async def get_agent_metrics(
        self,
        start_time: datetime,
        end_time: datetime,
        agent_name: Optional[str] = None,
    ) -> List[AgentMetrics]:
        """
        Get aggregated metrics for agents within a time range.

        Args:
            start_time: Start of time range (inclusive)
            end_time: End of time range (exclusive)
            agent_name: Optional filter for specific agent

        Returns:
            List of AgentMetrics for each agent
        """
        query = """
            SELECT
                metadata->>'agent_name' as agent_name,
                COUNT(*) as total_calls,
                COALESCE(SUM((generation->>'input_tokens')::int), 0) as input_tokens,
                COALESCE(SUM((generation->>'output_tokens')::int), 0) as output_tokens,
                COALESCE(SUM((generation->>'cost_usd')::numeric), 0) as cost_usd,
                AVG(EXTRACT(EPOCH FROM ("end"::timestamp - "start"::timestamp)) * 1000) as avg_latency_ms,
                SUM(CASE WHEN "isError" THEN 1 ELSE 0 END)::float / COUNT(*) as error_rate
            FROM steps
            WHERE
                "createdAt"::timestamp >= :start_time
                AND "createdAt"::timestamp < :end_time
                AND metadata->>'agent_name' IS NOT NULL
                {agent_filter}
            GROUP BY metadata->>'agent_name'
            ORDER BY total_calls DESC
        """

        agent_filter = ""
        params = {"start_time": start_time, "end_time": end_time}

        if agent_name:
            agent_filter = "AND metadata->>'agent_name' = :agent_name"
            params["agent_name"] = agent_name

        query = query.format(agent_filter=agent_filter)

        async with self.async_session() as session:
            result = await session.execute(text(query), params)
            rows = result.fetchall()

        return [
            AgentMetrics(
                agent_name=row.agent_name,
                total_calls=row.total_calls,
                total_input_tokens=row.input_tokens,
                total_output_tokens=row.output_tokens,
                total_cost_usd=float(row.cost_usd),
                avg_latency_ms=float(row.avg_latency_ms or 0),
                error_rate=float(row.error_rate or 0),
            )
            for row in rows
        ]

    async def get_feedback_by_agent(
        self,
        start_time: datetime,
        end_time: datetime,
        agent_name: Optional[str] = None,
        limit_comments: int = 5,
    ) -> List[FeedbackSummary]:
        """
        Get feedback attribution by agent.

        Args:
            start_time: Start of time range
            end_time: End of time range
            agent_name: Optional filter for specific agent
            limit_comments: Max comments to include per agent

        Returns:
            FeedbackSummary for each agent with feedback
        """
        query = """
            WITH agent_feedback AS (
                SELECT
                    s.metadata->>'agent_name' as agent_name,
                    f.value,
                    f.comment
                FROM feedbacks f
                JOIN steps s ON f."forId" = s.id
                WHERE
                    s."createdAt"::timestamp >= :start_time
                    AND s."createdAt"::timestamp < :end_time
                    AND s.metadata->>'agent_name' IS NOT NULL
                    {agent_filter}
            )
            SELECT
                agent_name,
                SUM(CASE WHEN value > 0 THEN 1 ELSE 0 END) as thumbs_up,
                SUM(CASE WHEN value < 0 THEN 1 ELSE 0 END) as thumbs_down,
                AVG(value)::float as sentiment_score,
                ARRAY_AGG(comment) FILTER (WHERE comment IS NOT NULL) as comments
            FROM agent_feedback
            GROUP BY agent_name
            ORDER BY thumbs_down DESC
        """
        # ... implementation similar to above ...

    async def get_token_usage_timeseries(
        self,
        start_time: datetime,
        end_time: datetime,
        granularity: str = "hour",  # "hour" | "day"
        agent_name: Optional[str] = None,
    ) -> List[dict]:
        """
        Get token usage as time series for charting.

        Returns list of {timestamp, agent_name, input_tokens, output_tokens, cost_usd}
        """
        query = """
            SELECT
                date_trunc(:granularity, "createdAt"::timestamp) as bucket,
                metadata->>'agent_name' as agent_name,
                SUM((generation->>'input_tokens')::int) as input_tokens,
                SUM((generation->>'output_tokens')::int) as output_tokens,
                SUM((generation->>'cost_usd')::numeric) as cost_usd
            FROM steps
            WHERE
                "createdAt"::timestamp >= :start_time
                AND "createdAt"::timestamp < :end_time
                AND generation IS NOT NULL
                {agent_filter}
            GROUP BY bucket, agent_name
            ORDER BY bucket, agent_name
        """
        # ... implementation ...
```

### 2. Add Query Endpoints Module

Create standalone query functions for use outside data layer:

```python
# src/datalayer/queries.py

from datetime import datetime, timedelta
from typing import Optional

from src.datalayer import get_data_layer

async def get_agent_dashboard_data(
    days: int = 7,
    agent_name: Optional[str] = None,
) -> dict:
    """
    Get all data needed for agent dashboard.

    Returns:
        {
            "metrics": [...],
            "feedback": [...],
            "token_timeseries": [...],
            "period": {"start": ..., "end": ...}
        }
    """
    end_time = datetime.utcnow()
    start_time = end_time - timedelta(days=days)

    data_layer = get_data_layer()

    return {
        "metrics": await data_layer.get_agent_metrics(
            start_time, end_time, agent_name
        ),
        "feedback": await data_layer.get_feedback_by_agent(
            start_time, end_time, agent_name
        ),
        "token_timeseries": await data_layer.get_token_usage_timeseries(
            start_time, end_time, agent_name=agent_name
        ),
        "period": {
            "start": start_time.isoformat(),
            "end": end_time.isoformat(),
        },
    }


async def export_metrics_csv(
    start_time: datetime,
    end_time: datetime,
    output_path: str,
) -> str:
    """Export metrics to CSV for external analysis."""
    import csv

    data_layer = get_data_layer()
    metrics = await data_layer.get_agent_metrics(start_time, end_time)

    with open(output_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=[
            'agent_name', 'total_calls', 'total_input_tokens',
            'total_output_tokens', 'total_cost_usd', 'avg_latency_ms', 'error_rate'
        ])
        writer.writeheader()
        for m in metrics:
            writer.writerow(m.__dict__)

    return output_path
```

### 3. Optional: FastAPI Endpoints

If external access is needed, add REST endpoints:

```python
# src/api/observability.py (optional)

from fastapi import APIRouter, Query
from datetime import datetime, timedelta

from src.datalayer.queries import get_agent_dashboard_data

router = APIRouter(prefix="/api/v1/observability", tags=["observability"])

@router.get("/agents/metrics")
async def get_metrics(
    days: int = Query(7, ge=1, le=90),
    agent_name: str = Query(None),
):
    """Get agent performance metrics."""
    return await get_agent_dashboard_data(days=days, agent_name=agent_name)

@router.get("/agents/{agent_name}/feedback")
async def get_agent_feedback(agent_name: str, days: int = 30):
    """Get feedback for a specific agent."""
    data_layer = get_data_layer()
    end_time = datetime.utcnow()
    start_time = end_time - timedelta(days=days)
    return await data_layer.get_feedback_by_agent(
        start_time, end_time, agent_name
    )
```

## Technical Details

### Files to Create/Modify

| File | Changes |
|------|---------|
| `src/datalayer/postgres.py` | Add query methods to data layer |
| `src/datalayer/queries.py` | New: Standalone query functions |
| `src/datalayer/__init__.py` | Export query functions |
| `src/api/observability.py` | New (optional): REST endpoints |

### Query Performance

All queries use the indexes created in earlier issues:
- `idx_steps_metadata_agent` - GIN index on `metadata->'agent_name'`
- `idx_steps_thread_id` - For joining with threads
- `idx_feedbacks_for_id` - For joining feedback with steps

Expected performance:
- Simple aggregations: < 100ms for 1M steps
- Time series (hourly, 7 days): < 200ms
- Feedback join: < 150ms

### Return Types

Use dataclasses for structured returns:

```python
@dataclass
class AgentMetrics:
    agent_name: str
    total_calls: int
    total_input_tokens: int
    total_output_tokens: int
    total_cost_usd: float
    avg_latency_ms: float
    error_rate: float

@dataclass
class FeedbackSummary:
    agent_name: str
    thumbs_up: int
    thumbs_down: int
    sentiment_score: float
    sample_comments: List[str]
```

## Acceptance Criteria

- [ ] `get_agent_metrics()` returns aggregated metrics by agent
- [ ] `get_feedback_by_agent()` returns feedback attribution
- [ ] `get_token_usage_timeseries()` returns data suitable for charting
- [ ] All queries support optional agent_name filter
- [ ] All queries support time range filtering
- [ ] Query performance < 200ms on 100k steps
- [ ] Unit tests for query logic
- [ ] Integration tests verify correct aggregation

## Testing Strategy

### Unit Tests
```python
async def test_get_agent_metrics_aggregation():
    # Insert test steps with known values
    # Query and verify aggregation is correct

async def test_feedback_attribution():
    # Insert step with agent metadata
    # Insert feedback for that step
    # Query and verify feedback is attributed correctly

async def test_timeseries_granularity():
    # Insert steps across multiple hours
    # Query with hourly granularity
    # Verify correct bucketing
```

### Integration Tests
- Test with realistic data volumes
- Verify index usage with EXPLAIN ANALYZE

## Dependencies

- Blocked by: #1.1 Agent Attribution, #1.2 Token Tracking
- Blocks: None (end of chain)

## Out of Scope

- GraphQL API (REST is sufficient for MVP)
- Real-time streaming updates (WebSocket)
- Pre-built dashboard UI (use Grafana or similar)
- Custom retention policies
