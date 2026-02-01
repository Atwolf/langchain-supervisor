# Enterprise Multiagent Framework - GitHub Issues Index

This directory contains detailed GitHub issue specifications for the enterprise multiagent framework. Each issue file is formatted for direct copy-paste into enterprise GitHub.

## Quick Reference

| Epic | Priority | Issues | Effort |
|------|----------|--------|--------|
| [Observability](#epic-1-agent-observability) | P1-High | 4 (1 epic + 3 features) | M-L |
| [Data Layer](#epic-2-enterprise-data-layer) | P1-High | 3 (1 epic + 2 features) | M |
| [Control Layer](#epic-3-agent-control-layer) | P0-Critical | 5 (1 epic + 4 features) | M-L |

---

## Suggested Labels

Create these labels in your GitHub repository before importing issues:

### Priority Labels
| Label | Color | Description |
|-------|-------|-------------|
| `P0-critical` | `#d73a4a` | Critical priority - blocks other work |
| `P1-high` | `#ff7619` | High priority - important for next milestone |
| `P2-medium` | `#fbca04` | Medium priority - nice to have |

### Type Labels
| Label | Color | Description |
|-------|-------|-------------|
| `epic` | `#7057ff` | Large initiative with multiple sub-issues |
| `feature` | `#0e8a16` | New feature or capability |
| `enhancement` | `#84b6eb` | Improvement to existing functionality |

### Area Labels
| Label | Color | Description |
|-------|-------|-------------|
| `observability` | `#006b75` | Metrics, tracing, and monitoring |
| `data-layer` | `#1d76db` | Database, storage, and persistence |
| `control-plane` | `#5319e7` | Agent management and orchestration |

### Effort Labels
| Label | Color | Description |
|-------|-------|-------------|
| `effort-s` | `#c2e0c6` | Small - 1-2 days |
| `effort-m` | `#bfdadc` | Medium - 3-5 days |
| `effort-l` | `#bfd4f2` | Large - 1-2 weeks |

### Special Labels
| Label | Color | Description |
|-------|-------|-------------|
| `good-first-issue` | `#7057ff` | Good for newcomers |
| `help-wanted` | `#008672` | Extra attention needed |
| `blocked` | `#b60205` | Blocked by another issue |

---

## Epic 1: Agent Observability

**Directory**: `epic-1-observability/`

Per-agent metrics and feedback attribution for understanding agent performance and user satisfaction.

| Issue | Title | Labels | Effort |
|-------|-------|--------|--------|
| [00-epic](epic-1-observability/00-epic-observability.md) | [Epic] Agent Observability: Per-Agent Metrics and Feedback Attribution | `epic`, `observability`, `P1-high` | - |
| [01-agent-attribution](epic-1-observability/01-agent-attribution.md) | [Feature] Enrich step metadata with agent identification | `feature`, `observability`, `effort-m`, `good-first-issue` | M |
| [02-token-usage-tracking](epic-1-observability/02-token-usage-tracking.md) | [Feature] Track and attribute token usage per agent and MCP | `feature`, `observability`, `effort-l` | L |
| [03-observability-query-layer](epic-1-observability/03-observability-query-layer.md) | [Feature] Query API for agent metrics and feedback attribution | `feature`, `observability`, `effort-m` | M |

---

## Epic 2: Enterprise Data Layer

**Directory**: `epic-2-data-layer/`

Enterprise-grade data layer extensions for audit logging and cloud storage integration.

| Issue | Title | Labels | Effort |
|-------|-------|--------|--------|
| [00-epic](epic-2-data-layer/00-epic-data-layer.md) | [Epic] Enterprise Data Layer Extension | `epic`, `data-layer`, `P1-high` | - |
| [01-audit-logging](epic-2-data-layer/01-audit-logging.md) | [Feature] Audit logging for data layer mutations | `feature`, `data-layer`, `effort-m`, `good-first-issue` | M |
| [02-s3-storage-client](epic-2-data-layer/02-s3-storage-client.md) | [Feature] S3-compatible storage client | `feature`, `data-layer`, `effort-m` | M |

---

## Epic 3: Agent Control Layer

**Directory**: `epic-3-control-layer/`

Dynamic agent management via API with database-backed configuration and hot-reload capabilities.

| Issue | Title | Labels | Effort |
|-------|-------|--------|--------|
| [00-epic](epic-3-control-layer/00-epic-control-layer.md) | [Epic] Agent Control Layer: Dynamic Agent Management | `epic`, `control-plane`, `P0-critical` | - |
| [01-database-schema](epic-3-control-layer/01-database-schema.md) | [Feature] Database schema for agents, MCPs, documentation | `feature`, `control-plane`, `effort-m` | M |
| [02-fastapi-crud-service](epic-3-control-layer/02-fastapi-crud-service.md) | [Feature] FastAPI CRUD service for agent management | `feature`, `control-plane`, `effort-l` | L |
| [03-lifecycle-state-machine](epic-3-control-layer/03-lifecycle-state-machine.md) | [Feature] Agent lifecycle state machine | `feature`, `control-plane`, `effort-m` | M |
| [04-dynamic-agent-loader](epic-3-control-layer/04-dynamic-agent-loader.md) | [Feature] Dynamic agent loader with hot-reload | `feature`, `control-plane`, `effort-l` | L |

---

## Dependency Graph

```
OBSERVABILITY          DATA LAYER           CONTROL LAYER
═══════════════        ═══════════          ══════════════

#1.1 Attribution       #2.1 Audit           #3.1 Schema
      │                (independent)              │
      ▼                                           ▼
#1.2 Token Tracking    #2.2 S3 Storage      #3.2 FastAPI CRUD
      │                (independent)              │
      ▼                                           ▼
#1.3 Query Layer                            #3.3 Lifecycle
                                                  │
                                                  ▼
                                            #3.4 Dynamic Loader
```

---

## Implementation Phases

### Phase 1: Foundation (Weeks 1-2)
Start with these independent issues that enable other work:

1. **#3.1** - Database Schema (enables all control layer features)
2. **#1.1** - Agent Attribution (low risk, high value)
3. **#2.1** - Audit Logging (independent, good first issue)

### Phase 2: Core Services (Weeks 3-4)
Build the main functionality:

4. **#3.2** - FastAPI CRUD Service
5. **#2.2** - S3 Storage Client
6. **#1.2** - Token Usage Tracking

### Phase 3: Integration (Weeks 5-6)
Connect all pieces together:

7. **#3.3** - Lifecycle State Machine
8. **#1.3** - Query Layer
9. **#3.4** - Dynamic Agent Loader

---

## How to Import Issues

1. **Create labels** using the table above
2. **Create epic issues first** (00-epic files)
3. **Create feature issues** and link to parent epics
4. **Set up dependencies** using GitHub's blocking feature or references
5. **Add to project board** (see [PROJECT_BOARD.md](PROJECT_BOARD.md))

### Manual Import Steps

For each issue file:
1. Open GitHub → Issues → New Issue
2. Copy the **Title** from the issue file
3. Copy everything from `## Summary` to the end into the description
4. Add labels from the issue file header
5. Link to parent epic using "Part of #X" in description

---

## File Structure

```
docs/issues/
├── INDEX.md                               ← You are here
├── PROJECT_BOARD.md                       ← GitHub Project board specification
├── epic-1-observability/
│   ├── 00-epic-observability.md
│   ├── 01-agent-attribution.md
│   ├── 02-token-usage-tracking.md
│   └── 03-observability-query-layer.md
├── epic-2-data-layer/
│   ├── 00-epic-data-layer.md
│   ├── 01-audit-logging.md
│   └── 02-s3-storage-client.md
└── epic-3-control-layer/
    ├── 00-epic-control-layer.md
    ├── 01-database-schema.md
    ├── 02-fastapi-crud-service.md
    ├── 03-lifecycle-state-machine.md
    └── 04-dynamic-agent-loader.md
```
