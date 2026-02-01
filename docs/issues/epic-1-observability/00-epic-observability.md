# [Epic] Agent Observability: Per-Agent Metrics and Feedback Attribution

**Labels**: `epic`, `observability`, `P1-high`

---

## Summary

Enable per-agent performance metrics and feedback attribution to understand which agents perform well and where users experience friction.

## Context

The current supervisor pattern routes queries to specialized sub-agents (`math_agent`, `weather_agent`, `movie_agent`), but there's no visibility into:

- Which agent handled a given step
- Token usage per agent or MCP server
- User feedback (thumbs up/down) correlated to specific agents
- Response latency broken down by agent

**Current State**:
- Steps are tracked in `steps` table with generic `metadata` JSONB field
- `ChainlitMiddlewareTracer` (`src/middleware/chainlit_middleware_tracer.py`) wraps tool calls as Chainlit Steps
- Feedback is stored in `feedbacks` table linked to `forId` (step ID)
- No agent context is propagated through the middleware

**Architecture Reference**:
- Supervisor pattern: `chainlit_app.py:63-119`
- Middleware tracer: `src/middleware/chainlit_middleware_tracer.py`
- Database schema: `datalayer/database/init/01-schema.sql`

## Problem Statement

Without agent-level observability:

1. **No performance debugging** - Can't identify which agent is slow or error-prone
2. **Feedback is orphaned** - User thumbs down doesn't tell us which agent disappointed them
3. **Capacity planning impossible** - Can't predict token costs per agent
4. **A/B testing blocked** - Can't compare agent versions or prompts

## Proposed Solution

### Phase 1: Agent Attribution (#1.1)
Enrich step metadata with agent identification:
- Add `agent_name` and `agent_type` to step metadata
- Track whether supervisor or direct agent handled the request
- Pass context through middleware to tool calls

### Phase 2: Token Tracking (#1.2)
Track and attribute token usage:
- Capture input/output tokens per LLM call
- Attribute to agent and MCP server
- Store in queryable format

### Phase 3: Query Layer (#1.3)
Build query API for analytics:
- Agent performance dashboard queries
- Feedback attribution reports
- Time-series metrics for trending

## Child Issues

| # | Title | Effort | Status |
|---|-------|--------|--------|
| #1.1 | [Feature] Enrich step metadata with agent identification | M | - [ ] |
| #1.2 | [Feature] Track and attribute token usage per agent and MCP | L | - [ ] |
| #1.3 | [Feature] Query API for agent metrics and feedback attribution | M | - [ ] |

## Success Metrics

- 100% of steps have `agent_name` in metadata
- Token usage tracked within 5% accuracy of actual billing
- Feedback can be queried by agent with < 100ms latency

## Dependencies

- Blocked by: None
- Blocks: Future A/B testing framework, cost allocation system

## Out of Scope

- Real-time streaming dashboards (use existing tools like Grafana)
- Distributed tracing integration (OpenTelemetry) - separate epic
- Custom metric collectors (Prometheus exporters) - separate epic
