# [Feature] Track and attribute token usage per agent and MCP

**Labels**: `feature`, `observability`, `effort-l`

**Part of**: [Epic] Agent Observability (#1.0)

---

## Summary

Capture input/output token counts for every LLM call and attribute them to the originating agent and MCP server for cost allocation and capacity planning.

## Context

The framework uses `ChatAnthropic` for all LLM calls, but token usage is not tracked. Anthropic's API returns token counts in the response, which we can capture and store.

**Current LLM Usage** (`chainlit_app.py:72`):
```python
llm = ChatAnthropic(model=os.environ.get("LLM_MODEL", "claude-sonnet-4-5-20250514"))
```

**Agent Creation** (`chainlit_app.py:80-85`):
```python
sub_agents[agent.name] = create_agent(
    llm,
    tools=agent_tools,
    system_prompt=f"You are the {agent.name}. {agent.description}",
    middleware=middleware,
)
```

**MCP Tool Loading** (`chainlit_app.py:174-181`):
```python
for tool in all_mcp_tools:
    for server_name, agent_name in agent_mcp_mapping.items():
        mcp_tools.setdefault(agent_name, []).append(tool)
```

## Problem Statement

Without token tracking:

1. **Cost allocation impossible** - Can't charge-back to teams using specific agents
2. **Budget alerts missing** - No way to detect runaway costs
3. **Optimization blind** - Can't identify which agents consume most tokens
4. **MCP cost attribution** - Don't know if MCP tools add significant token overhead

## Proposed Solution

### 1. Extend Step Schema for Token Data

Add token tracking fields to the existing `generation` JSONB column:

```json
{
  "model": "claude-sonnet-4-5-20250514",
  "input_tokens": 1523,
  "output_tokens": 847,
  "total_tokens": 2370,
  "cache_read_tokens": 200,
  "cache_write_tokens": 0,
  "cost_usd": 0.0142,
  "mcp_server": "movies"
}
```

### 2. Create Token Tracking Middleware

Add a new middleware layer that captures LLM response metadata:

```python
# src/middleware/token_tracker.py
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import AIMessage

class TokenTrackingMiddleware(AgentMiddleware):
    """Captures token usage from LLM responses."""

    def __init__(self, agent_name: str, mcp_server: str = None):
        super().__init__()
        self.agent_name = agent_name
        self.mcp_server = mcp_server

    async def awrap_llm_call(self, messages, handler):
        """Wrap LLM calls to capture token usage."""
        response: AIMessage = await handler(messages)

        # Extract usage from response metadata
        usage = getattr(response, 'usage_metadata', None)
        if usage:
            await self._record_usage(
                input_tokens=usage.get('input_tokens', 0),
                output_tokens=usage.get('output_tokens', 0),
                cache_read=usage.get('cache_read_input_tokens', 0),
                cache_write=usage.get('cache_creation_input_tokens', 0),
            )

        return response

    async def _record_usage(self, **kwargs):
        """Store token usage in current step's generation field."""
        from chainlit.context import context_var

        ctx = context_var.get()
        if ctx and ctx.current_step:
            step = ctx.current_step
            step.generation = {
                **(step.generation or {}),
                "agent_name": self.agent_name,
                "mcp_server": self.mcp_server,
                **kwargs,
                "cost_usd": self._calculate_cost(**kwargs),
            }

    def _calculate_cost(self, input_tokens, output_tokens, cache_read, **_):
        """Calculate cost based on Claude pricing."""
        # Claude Sonnet 3.5 pricing (example)
        INPUT_COST = 0.003 / 1000   # $3 per million input
        OUTPUT_COST = 0.015 / 1000  # $15 per million output
        CACHE_READ_COST = 0.0003 / 1000  # 90% discount

        return (
            (input_tokens - cache_read) * INPUT_COST +
            cache_read * CACHE_READ_COST +
            output_tokens * OUTPUT_COST
        )
```

### 3. Aggregate Token Usage Table

Create a materialized view or aggregation table for efficient reporting:

```sql
-- datalayer/database/init/03-token-aggregates.sql

-- Aggregated token usage by agent (materialized view)
CREATE MATERIALIZED VIEW IF NOT EXISTS agent_token_usage AS
SELECT
    date_trunc('hour', "createdAt"::timestamp) as hour,
    metadata->>'agent_name' as agent_name,
    generation->>'mcp_server' as mcp_server,
    COUNT(*) as call_count,
    SUM((generation->>'input_tokens')::int) as total_input_tokens,
    SUM((generation->>'output_tokens')::int) as total_output_tokens,
    SUM((generation->>'cost_usd')::numeric) as total_cost_usd
FROM steps
WHERE generation IS NOT NULL
GROUP BY 1, 2, 3;

-- Refresh index for the materialized view
CREATE UNIQUE INDEX idx_agent_token_usage_unique
ON agent_token_usage (hour, agent_name, mcp_server);

-- Function to refresh the view (call periodically)
CREATE OR REPLACE FUNCTION refresh_token_usage()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY agent_token_usage;
END;
$$ LANGUAGE plpgsql;
```

### 4. Wire Up Middleware in Agent Builder

```python
# chainlit_app.py - Updated build_agents

def build_agents(agents, mcp_tools=None):
    # ...
    for agent in agents:
        agent_mcp_names = [Path(m).stem for m in agent.mcps]
        mcp_name = agent_mcp_names[0] if agent_mcp_names else None

        agent_middleware = [
            ChainlitMiddlewareTracer(agent_name=agent.name),
            TokenTrackingMiddleware(
                agent_name=agent.name,
                mcp_server=mcp_name
            ),
        ]

        sub_agents[agent.name] = create_agent(
            llm,
            tools=agent_tools,
            middleware=agent_middleware,
        )
```

## Technical Details

### Files to Create/Modify

| File | Changes |
|------|---------|
| `src/middleware/token_tracker.py` | New: Token tracking middleware |
| `src/middleware/__init__.py` | Export `TokenTrackingMiddleware` |
| `chainlit_app.py` | Add token middleware to agent builder |
| `datalayer/database/init/03-token-aggregates.sql` | New: Aggregation schema |

### Token Response Format (Anthropic)

LangChain's `ChatAnthropic` returns usage in `AIMessage.usage_metadata`:

```python
{
    'input_tokens': 1523,
    'output_tokens': 847,
    'cache_read_input_tokens': 200,
    'cache_creation_input_tokens': 0,
}
```

### Cost Calculation

| Model | Input (per 1M) | Output (per 1M) | Cache Read |
|-------|----------------|-----------------|------------|
| Claude 3.5 Sonnet | $3.00 | $15.00 | $0.30 |
| Claude 3 Haiku | $0.25 | $1.25 | $0.025 |

Note: Prices should be configurable via environment variables.

### Error Handling

- If `usage_metadata` is missing (streaming or error), log but don't fail
- If step context unavailable, queue metrics for later processing
- Handle database insert failures gracefully

## Acceptance Criteria

- [ ] `TokenTrackingMiddleware` captures token counts from LLM responses
- [ ] Token data stored in step's `generation` JSONB field
- [ ] MCP server attribution included when applicable
- [ ] Cost calculated using configurable pricing
- [ ] Materialized view aggregates hourly usage by agent
- [ ] Unit tests for cost calculation
- [ ] Integration tests verify token persistence

## Testing Strategy

### Unit Tests
```python
def test_cost_calculation():
    middleware = TokenTrackingMiddleware(agent_name="test")
    cost = middleware._calculate_cost(
        input_tokens=1000,
        output_tokens=500,
        cache_read=100,
    )
    expected = (900 * 0.003 + 100 * 0.0003 + 500 * 0.015) / 1000
    assert abs(cost - expected) < 0.0001

def test_token_extraction_from_response():
    # Mock AIMessage with usage_metadata
    pass
```

### Integration Tests
- End-to-end test: invoke agent, verify tokens in database
- Test materialized view refresh

## Dependencies

- Blocked by: #1.1 Agent Attribution (needs agent_name in context)
- Blocks: #1.3 Query Layer

## Out of Scope

- Real-time cost alerts (separate monitoring system)
- Budget enforcement / rate limiting
- Historical data backfill
- Support for other LLM providers (OpenAI, etc.)
