# [Feature] Enrich step metadata with agent identification

**Labels**: `feature`, `observability`, `effort-m`, `good-first-issue`

**Part of**: [Epic] Agent Observability (#1.0)

---

## Summary

Add agent identification metadata to every Chainlit step, enabling per-agent analytics and feedback attribution.

## Context

The `ChainlitMiddlewareTracer` class wraps tool calls as Chainlit Steps, but doesn't capture which agent initiated the call. This makes it impossible to:

- Know which agent handled a user's request
- Attribute feedback to the correct agent
- Debug agent-specific performance issues

**Current Middleware** (`src/middleware/chainlit_middleware_tracer.py:54-113`):
```python
async def awrap_tool_call(
    self,
    request: ToolCallRequest,
    handler: Callable[[ToolCallRequest], ToolMessage | Command],
):
    tool_name = request.tool_call["name"]
    # No agent context available here
    step = Step(name=tool_name, type="tool", parent_id=parent_step_id)
    # Step metadata is empty - no agent attribution
```

**Agent Building** (`chainlit_app.py:63-119`):
```python
sub_agents[agent.name] = create_agent(
    llm,
    tools=agent_tools,
    system_prompt=f"You are the {agent.name}. {agent.description}",
    middleware=middleware,  # Same middleware instance for all agents
)
```

## Problem Statement

When a user submits feedback or reports an issue, we can't identify which agent was responsible because:

1. The middleware doesn't know which agent invoked it
2. Step metadata doesn't include agent identification
3. The supervisor's delegation is not traced

## Proposed Solution

### 1. Extend Middleware with Agent Context

Modify `ChainlitMiddlewareTracer` to accept agent context at construction:

```python
class ChainlitMiddlewareTracer(AgentMiddleware):
    def __init__(self, agent_name: str = None, agent_type: str = "sub_agent"):
        super().__init__()
        self.agent_name = agent_name
        self.agent_type = agent_type  # "supervisor" | "sub_agent"
        self.active_steps: dict[str, Step] = {}
```

### 2. Inject Agent Context into Steps

Update `awrap_tool_call` to include agent metadata:

```python
async def awrap_tool_call(self, request, handler):
    # ... existing code ...

    step = Step(name=tool_name, type="tool", parent_id=parent_step_id)

    # NEW: Add agent attribution
    step.metadata = {
        "agent_name": self.agent_name,
        "agent_type": self.agent_type,
        "tool_name": tool_name,
        "invoked_at": utc_now(),
    }

    # ... rest of method ...
```

### 3. Create Per-Agent Middleware Instances

Update `build_agents` to create separate middleware per agent:

```python
def build_agents(agents: list[AgentRecord], mcp_tools=None, middleware_factory=None):
    # ...
    for agent in agents:
        # Create agent-specific middleware
        agent_middleware = [
            ChainlitMiddlewareTracer(
                agent_name=agent.name,
                agent_type="sub_agent"
            )
        ]

        sub_agents[agent.name] = create_agent(
            llm,
            tools=agent_tools,
            middleware=agent_middleware,
        )

    # Supervisor gets its own middleware
    supervisor_middleware = [
        ChainlitMiddlewareTracer(
            agent_name="supervisor",
            agent_type="supervisor"
        )
    ]
```

### 4. Add Database Index for Querying

Add GIN index for efficient metadata queries:

```sql
-- In new migration file: 02-observability-indexes.sql
CREATE INDEX IF NOT EXISTS idx_steps_metadata_agent
ON steps USING GIN ((metadata->'agent_name'));
```

## Technical Details

### Files to Modify

| File | Changes |
|------|---------|
| `src/middleware/chainlit_middleware_tracer.py` | Add agent context to constructor and step metadata |
| `chainlit_app.py` | Create per-agent middleware instances in `build_agents` |
| `datalayer/database/init/02-observability-indexes.sql` | Add GIN index for metadata queries |

### Metadata Schema

```json
{
  "agent_name": "math_agent",
  "agent_type": "sub_agent",
  "tool_name": "calculate",
  "invoked_at": "2024-01-15T10:30:00Z",
  "supervisor_delegated": true
}
```

### Backward Compatibility

- Existing steps without `agent_name` metadata will continue to work
- Query layer should handle `NULL` agent_name gracefully
- No schema migrations required for existing data

## Acceptance Criteria

- [ ] `ChainlitMiddlewareTracer` accepts `agent_name` and `agent_type` parameters
- [ ] Every tool call step includes agent metadata
- [ ] Supervisor delegation steps are marked with `agent_type: "supervisor"`
- [ ] Database index exists for `metadata->'agent_name'`
- [ ] Unit tests cover middleware with agent context
- [ ] Existing functionality (tool tracing) continues to work

## Testing Strategy

### Unit Tests
```python
def test_middleware_includes_agent_metadata():
    middleware = ChainlitMiddlewareTracer(
        agent_name="test_agent",
        agent_type="sub_agent"
    )
    # Mock tool call and verify step metadata

def test_middleware_default_values():
    middleware = ChainlitMiddlewareTracer()
    assert middleware.agent_name is None
    assert middleware.agent_type == "sub_agent"
```

### Integration Tests
- Verify metadata persists to database
- Query steps by agent_name using new index

## Dependencies

- Blocked by: None
- Blocks: #1.2 Token Usage Tracking, #1.3 Query Layer

## Out of Scope

- Supervisor decision logging (why it chose an agent)
- Token counting (covered in #1.2)
- Query API (covered in #1.3)
