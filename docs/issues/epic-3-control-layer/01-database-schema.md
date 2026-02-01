# [Feature] Database schema for agents, MCPs, documentation

**Labels**: `feature`, `control-plane`, `effort-m`

**Part of**: [Epic] Agent Control Layer (#3.0)

---

## Summary

Design and implement database schema for storing agent configurations, MCP server definitions, and agent documentation to enable dynamic agent management.

## Context

Agents are currently defined in Python code with the `AgentRecord` dataclass.

**Current Model** (`src/agents/models.py`):
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

**Limitations**:
- Tools are Python callables - can't serialize to database
- MCPs are file paths - need structured definition
- No versioning or lifecycle state
- No documentation storage

## Problem Statement

To enable dynamic agent management, we need:

1. **Persistent storage** - Agents survive restarts
2. **Structured MCPs** - Store server configurations, not file paths
3. **Documentation** - Rich context for agents (examples, guidelines)
4. **Versioning** - Track changes over time
5. **State management** - Enable/disable agents without deletion

## Proposed Solution

### 1. Schema Design

```sql
-- datalayer/database/init/10-agent-control-layer.sql

-- Enum for agent lifecycle states
CREATE TYPE agent_state AS ENUM ('draft', 'active', 'deprecated', 'archived');

-- Enum for MCP transport types
CREATE TYPE mcp_transport AS ENUM ('stdio', 'sse', 'websocket');

-- Main agents table
CREATE TABLE IF NOT EXISTS agents (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL UNIQUE,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "routeDescription" TEXT NOT NULL,
    "systemPrompt" TEXT,
    "icon" TEXT,
    "state" agent_state NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "createdBy" TEXT,
    "updatedBy" TEXT
);

-- MCP server definitions (reusable across agents)
CREATE TABLE IF NOT EXISTS mcp_servers (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL UNIQUE,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "transport" mcp_transport NOT NULL DEFAULT 'stdio',
    "command" TEXT,           -- For stdio: executable command
    "args" TEXT[],            -- For stdio: command arguments
    "url" TEXT,               -- For sse/websocket: server URL
    "env" JSONB DEFAULT '{}', -- Environment variables
    "healthCheckUrl" TEXT,    -- Optional health endpoint
    "metadata" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Junction table for agent-MCP relationships
CREATE TABLE IF NOT EXISTS agent_mcps (
    "agentId" UUID NOT NULL REFERENCES agents("id") ON DELETE CASCADE,
    "mcpId" UUID NOT NULL REFERENCES mcp_servers("id") ON DELETE CASCADE,
    "priority" INTEGER NOT NULL DEFAULT 0, -- Order of MCP loading
    "config" JSONB DEFAULT '{}',           -- Agent-specific MCP config
    PRIMARY KEY ("agentId", "mcpId")
);

-- Agent documentation (examples, guidelines, context)
CREATE TABLE IF NOT EXISTS agent_documentation (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "agentId" UUID NOT NULL REFERENCES agents("id") ON DELETE CASCADE,
    "type" TEXT NOT NULL,      -- 'example', 'guideline', 'context', 'changelog'
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB DEFAULT '{}',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Built-in tools registry (native Python tools)
CREATE TABLE IF NOT EXISTS tool_registry (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL UNIQUE,
    "modulePath" TEXT NOT NULL,     -- Python import path
    "functionName" TEXT NOT NULL,   -- Function to import
    "description" TEXT NOT NULL,
    "inputSchema" JSONB,            -- JSON Schema for inputs
    "metadata" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Junction table for agent-tool relationships
CREATE TABLE IF NOT EXISTS agent_tools (
    "agentId" UUID NOT NULL REFERENCES agents("id") ON DELETE CASCADE,
    "toolId" UUID NOT NULL REFERENCES tool_registry("id") ON DELETE CASCADE,
    "config" JSONB DEFAULT '{}', -- Tool-specific config overrides
    PRIMARY KEY ("agentId", "toolId")
);

-- Agent version history (audit trail)
CREATE TABLE IF NOT EXISTS agent_versions (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "agentId" UUID NOT NULL REFERENCES agents("id") ON DELETE CASCADE,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,  -- Full agent config at this version
    "changeReason" TEXT,
    "changedBy" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_agents_state ON agents("state");
CREATE INDEX idx_agents_name ON agents("name");
CREATE INDEX idx_agent_mcps_agent ON agent_mcps("agentId");
CREATE INDEX idx_agent_docs_agent ON agent_documentation("agentId");
CREATE INDEX idx_agent_tools_agent ON agent_tools("agentId");
CREATE INDEX idx_agent_versions_agent ON agent_versions("agentId", "version" DESC);

-- Trigger to update updatedAt timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agents_updated_at
    BEFORE UPDATE ON agents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER mcp_servers_updated_at
    BEFORE UPDATE ON mcp_servers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### 2. SQLAlchemy Models

```python
# src/control_layer/models.py

from datetime import datetime
from enum import Enum
from typing import List, Optional
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, String, Text, Integer, ARRAY
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID, ENUM
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class AgentState(str, Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    DEPRECATED = "deprecated"
    ARCHIVED = "archived"


class MCPTransport(str, Enum):
    STDIO = "stdio"
    SSE = "sse"
    WEBSOCKET = "websocket"


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[UUID] = mapped_column(PG_UUID, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column("displayName", String, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    route_description: Mapped[str] = mapped_column("routeDescription", Text, nullable=False)
    system_prompt: Mapped[Optional[str]] = mapped_column("systemPrompt", Text)
    icon: Mapped[Optional[str]] = mapped_column(String)
    state: Mapped[AgentState] = mapped_column(
        ENUM(AgentState, name="agent_state"),
        default=AgentState.DRAFT
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    metadata: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column("createdAt", default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column("updatedAt", default=datetime.utcnow)
    created_by: Mapped[Optional[str]] = mapped_column("createdBy", String)
    updated_by: Mapped[Optional[str]] = mapped_column("updatedBy", String)

    # Relationships
    mcps: Mapped[List["AgentMCP"]] = relationship(back_populates="agent", cascade="all, delete-orphan")
    tools: Mapped[List["AgentTool"]] = relationship(back_populates="agent", cascade="all, delete-orphan")
    documentation: Mapped[List["AgentDocumentation"]] = relationship(back_populates="agent", cascade="all, delete-orphan")
    versions: Mapped[List["AgentVersion"]] = relationship(back_populates="agent", cascade="all, delete-orphan")


class MCPServer(Base):
    __tablename__ = "mcp_servers"

    id: Mapped[UUID] = mapped_column(PG_UUID, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column("displayName", String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    transport: Mapped[MCPTransport] = mapped_column(
        ENUM(MCPTransport, name="mcp_transport"),
        default=MCPTransport.STDIO
    )
    command: Mapped[Optional[str]] = mapped_column(String)
    args: Mapped[Optional[List[str]]] = mapped_column(ARRAY(String))
    url: Mapped[Optional[str]] = mapped_column(String)
    env: Mapped[dict] = mapped_column(JSONB, default=dict)
    health_check_url: Mapped[Optional[str]] = mapped_column("healthCheckUrl", String)
    metadata: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column("createdAt", default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column("updatedAt", default=datetime.utcnow)


class AgentMCP(Base):
    __tablename__ = "agent_mcps"

    agent_id: Mapped[UUID] = mapped_column("agentId", ForeignKey("agents.id"), primary_key=True)
    mcp_id: Mapped[UUID] = mapped_column("mcpId", ForeignKey("mcp_servers.id"), primary_key=True)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    config: Mapped[dict] = mapped_column(JSONB, default=dict)

    agent: Mapped["Agent"] = relationship(back_populates="mcps")
    mcp: Mapped["MCPServer"] = relationship()


class ToolRegistry(Base):
    __tablename__ = "tool_registry"

    id: Mapped[UUID] = mapped_column(PG_UUID, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    module_path: Mapped[str] = mapped_column("modulePath", String, nullable=False)
    function_name: Mapped[str] = mapped_column("functionName", String, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    input_schema: Mapped[Optional[dict]] = mapped_column("inputSchema", JSONB)
    metadata: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column("createdAt", default=datetime.utcnow)


class AgentTool(Base):
    __tablename__ = "agent_tools"

    agent_id: Mapped[UUID] = mapped_column("agentId", ForeignKey("agents.id"), primary_key=True)
    tool_id: Mapped[UUID] = mapped_column("toolId", ForeignKey("tool_registry.id"), primary_key=True)
    config: Mapped[dict] = mapped_column(JSONB, default=dict)

    agent: Mapped["Agent"] = relationship(back_populates="tools")
    tool: Mapped["ToolRegistry"] = relationship()


class AgentDocumentation(Base):
    __tablename__ = "agent_documentation"

    id: Mapped[UUID] = mapped_column(PG_UUID, primary_key=True, default=uuid4)
    agent_id: Mapped[UUID] = mapped_column("agentId", ForeignKey("agents.id"), nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    metadata: Mapped[dict] = mapped_column(JSONB, default=dict)
    order_index: Mapped[int] = mapped_column("orderIndex", Integer, default=0)
    created_at: Mapped[datetime] = mapped_column("createdAt", default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column("updatedAt", default=datetime.utcnow)

    agent: Mapped["Agent"] = relationship(back_populates="documentation")


class AgentVersion(Base):
    __tablename__ = "agent_versions"

    id: Mapped[UUID] = mapped_column(PG_UUID, primary_key=True, default=uuid4)
    agent_id: Mapped[UUID] = mapped_column("agentId", ForeignKey("agents.id"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    change_reason: Mapped[Optional[str]] = mapped_column("changeReason", Text)
    changed_by: Mapped[Optional[str]] = mapped_column("changedBy", String)
    created_at: Mapped[datetime] = mapped_column("createdAt", default=datetime.utcnow)

    agent: Mapped["Agent"] = relationship(back_populates="versions")
```

### 3. Migration Script for Existing Agents

```python
# scripts/migrate_agents_to_db.py

"""
Migrate existing agents from Python code to database.
Run once after schema is applied.
"""

import asyncio
from uuid import uuid4

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from src.agents import AGENTS
from src.control_layer.models import Agent, MCPServer, AgentMCP, ToolRegistry, AgentTool


async def migrate_agents(database_url: str):
    engine = create_async_engine(database_url)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        for agent_record in AGENTS:
            # Check if agent already exists
            existing = await session.execute(
                select(Agent).where(Agent.name == agent_record.name)
            )
            if existing.scalar():
                print(f"Agent {agent_record.name} already exists, skipping")
                continue

            # Create agent
            agent = Agent(
                id=uuid4(),
                name=agent_record.name,
                display_name=agent_record.name.replace("_", " ").title(),
                description=agent_record.description,
                route_description=agent_record.route_description,
                icon=agent_record.icon,
                state="active",  # Existing agents are active
            )
            session.add(agent)

            # Create MCP servers and links
            for mcp_path in agent_record.mcps:
                server_name = Path(mcp_path).stem
                mcp_server = MCPServer(
                    id=uuid4(),
                    name=server_name,
                    display_name=server_name.replace("_", " ").title(),
                    transport="stdio",
                    command="uv",
                    args=["run", "python", mcp_path],
                )
                session.add(mcp_server)

                agent_mcp = AgentMCP(
                    agent_id=agent.id,
                    mcp_id=mcp_server.id,
                    priority=0,
                )
                session.add(agent_mcp)

            # Register tools
            for tool in agent_record.tools:
                # Get module and function info
                module_path = tool.__module__
                function_name = tool.__name__

                tool_record = ToolRegistry(
                    id=uuid4(),
                    name=tool.name,
                    module_path=module_path,
                    function_name=function_name,
                    description=tool.description,
                )
                session.add(tool_record)

                agent_tool = AgentTool(
                    agent_id=agent.id,
                    tool_id=tool_record.id,
                )
                session.add(agent_tool)

            print(f"Migrated agent: {agent_record.name}")

        await session.commit()
        print("Migration complete!")


if __name__ == "__main__":
    import os
    asyncio.run(migrate_agents(os.environ["DATABASE_URL"]))
```

## Technical Details

### Files to Create

| File | Description |
|------|-------------|
| `datalayer/database/init/10-agent-control-layer.sql` | Schema definition |
| `src/control_layer/__init__.py` | Package init |
| `src/control_layer/models.py` | SQLAlchemy ORM models |
| `scripts/migrate_agents_to_db.py` | One-time migration script |

### Schema Relationships

```
agents ─┬─< agent_mcps >─ mcp_servers
        ├─< agent_tools >─ tool_registry
        ├─< agent_documentation
        └─< agent_versions
```

### Naming Conventions

- Database: camelCase for Chainlit compatibility
- Python: snake_case with `mapped_column("camelCase", ...)`
- API: camelCase for JSON responses

### Version Control

Each agent update:
1. Increments `version` field
2. Creates snapshot in `agent_versions`
3. Records `changedBy` and `changeReason`

## Acceptance Criteria

- [ ] Schema creates successfully on fresh database
- [ ] SQLAlchemy models map correctly to schema
- [ ] Existing agents can be migrated via script
- [ ] Indexes exist for common query patterns
- [ ] `updatedAt` trigger fires on updates
- [ ] Version history captured on agent changes
- [ ] Unit tests for model relationships

## Testing Strategy

### Unit Tests
```python
def test_agent_creation():
    agent = Agent(
        name="test_agent",
        display_name="Test Agent",
        description="A test agent",
        route_description="Test routing",
    )
    assert agent.state == AgentState.DRAFT
    assert agent.version == 1

def test_agent_mcp_relationship():
    agent = Agent(...)
    mcp = MCPServer(...)
    agent_mcp = AgentMCP(agent=agent, mcp=mcp, priority=1)
    assert agent_mcp in agent.mcps
```

### Integration Tests
- Create full agent with MCPs, tools, documentation
- Verify cascading deletes
- Test version history creation

## Dependencies

- Blocked by: None
- Blocks: #3.2 FastAPI CRUD, #3.3 Lifecycle, #3.4 Dynamic Loader

## Out of Scope

- Tool sandbox/isolation configuration
- Agent permission model (RBAC)
- Multi-tenancy partitioning
