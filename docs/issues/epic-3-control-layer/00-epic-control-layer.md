# [Epic] Agent Control Layer: Dynamic Agent Management

**Labels**: `epic`, `control-plane`, `P0-critical`

---

## Summary

Build a control layer for dynamic agent management via API, enabling runtime agent configuration, lifecycle management, and hot-reload without service restarts.

## Context

Agents are currently defined as static Python code in `src/agents/default_agents.py` and loaded at startup.

**Current Architecture**:
- `AgentRecord` dataclass (`src/agents/models.py`)
- Static agent list (`src/agents/default_agents.py`)
- One-time agent loading (`chainlit_app.py` on_chat_start)

**AgentRecord Definition** (`src/agents/models.py`):
```python
@dataclass
class AgentRecord:
    name: str
    description: str
    route_description: str
    tools: list[Callable] = field(default_factory=list)
    mcps: list[str] = field(default_factory=list)
    icon: str | None = None
```

**Current Agent Loading** (`chainlit_app.py:148-198`):
- Reads from `AGENTS` list
- Builds MCP connections for each agent
- Creates supervisor and sub-agents
- Stores in user session

## Problem Statement

Static agent configuration limits operational flexibility:

1. **No runtime updates** - Adding agents requires code deployment
2. **No lifecycle control** - Can't disable agents without code changes
3. **No versioning** - Can't test new agent versions alongside production
4. **No self-service** - Engineers can't onboard new agents without PR review

## Proposed Solution

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Control Layer                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │  FastAPI    │    │  Agent DB   │    │  Dynamic Loader │  │
│  │  CRUD API   │───▶│  (Postgres) │◀───│  (Hot Reload)   │  │
│  └─────────────┘    └─────────────┘    └─────────────────┘  │
│         ▲                                       │            │
│         │                                       ▼            │
│  Admin UI / CLI                        Chainlit Runtime      │
└─────────────────────────────────────────────────────────────┘
```

### Phase 1: Database Schema (#3.1)
Define database schema for agents, MCPs, and documentation:
- `agents` table with versioning
- `agent_mcps` junction table
- `agent_documentation` for context injection

### Phase 2: FastAPI CRUD (#3.2)
REST API for agent management:
- CRUD operations for agents
- MCP configuration management
- Bulk import/export

### Phase 3: Lifecycle State Machine (#3.3)
Agent state management:
- States: draft → active → deprecated → archived
- Transitions with validation
- Audit trail for state changes

### Phase 4: Dynamic Loader (#3.4)
Hot-reload agents at runtime:
- Watch for database changes
- Rebuild supervisor tools dynamically
- Zero-downtime updates

## Child Issues

| # | Title | Effort | Status |
|---|-------|--------|--------|
| #3.1 | [Feature] Database schema for agents, MCPs, documentation | M | - [ ] |
| #3.2 | [Feature] FastAPI CRUD service for agent management | L | - [ ] |
| #3.3 | [Feature] Agent lifecycle state machine | M | - [ ] |
| #3.4 | [Feature] Dynamic agent loader with hot-reload | L | - [ ] |

## Success Metrics

- API latency < 100ms for CRUD operations
- Agent hot-reload completes in < 5 seconds
- Zero downtime during agent updates
- 100% of agent changes audited

## Dependencies

- Blocked by: None
- Blocks: Future agent marketplace, self-service agent onboarding

## Out of Scope

- Agent marketplace UI
- Multi-tenancy (isolated agent pools per team)
- Agent performance optimization recommendations
- Automated agent testing framework
