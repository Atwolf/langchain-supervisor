# [Feature] FastAPI CRUD service for agent management

**Labels**: `feature`, `control-plane`, `effort-l`

**Part of**: [Epic] Agent Control Layer (#3.0)

---

## Summary

Build a FastAPI-based REST API for managing agents, MCP servers, and documentation, enabling programmatic agent configuration without code changes.

## Context

With the database schema (#3.1) in place, we need an API layer for CRUD operations.

**Current Agent Definition** (`src/agents/default_agents.py`):
- Static Python code
- Requires code deployment to change
- No API for management

**Target State**:
- REST API at `/api/v1/agents`
- CRUD for agents, MCPs, tools, documentation
- Bulk operations for import/export
- Swagger/OpenAPI documentation

## Problem Statement

Without an API:

1. **No programmatic access** - Can't build admin UIs or CLI tools
2. **No automation** - CI/CD can't deploy agent changes
3. **No self-service** - Teams can't manage their agents
4. **No auditability** - Changes aren't tracked systematically

## Proposed Solution

### 1. API Structure

```
/api/v1/
├── agents/
│   ├── GET     /              # List agents (with filtering)
│   ├── POST    /              # Create agent
│   ├── GET     /{id}          # Get agent details
│   ├── PUT     /{id}          # Update agent
│   ├── DELETE  /{id}          # Delete agent
│   ├── GET     /{id}/versions # Get version history
│   └── POST    /{id}/restore  # Restore to previous version
├── mcps/
│   ├── GET     /              # List MCP servers
│   ├── POST    /              # Create MCP server
│   ├── GET     /{id}          # Get MCP details
│   ├── PUT     /{id}          # Update MCP
│   └── DELETE  /{id}          # Delete MCP
├── tools/
│   ├── GET     /              # List registered tools
│   └── GET     /{id}          # Get tool details
└── bulk/
    ├── POST    /export        # Export all agents as JSON
    └── POST    /import        # Import agents from JSON
```

### 2. Pydantic Schemas

```python
# src/control_layer/schemas.py

from datetime import datetime
from enum import Enum
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class AgentState(str, Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    DEPRECATED = "deprecated"
    ARCHIVED = "archived"


class MCPTransport(str, Enum):
    STDIO = "stdio"
    SSE = "sse"
    WEBSOCKET = "websocket"


# ========== MCP Schemas ==========

class MCPServerBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    displayName: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    transport: MCPTransport = MCPTransport.STDIO
    command: Optional[str] = None
    args: Optional[List[str]] = None
    url: Optional[str] = None
    env: dict = Field(default_factory=dict)
    healthCheckUrl: Optional[str] = None


class MCPServerCreate(MCPServerBase):
    pass


class MCPServerUpdate(BaseModel):
    displayName: Optional[str] = None
    description: Optional[str] = None
    transport: Optional[MCPTransport] = None
    command: Optional[str] = None
    args: Optional[List[str]] = None
    url: Optional[str] = None
    env: Optional[dict] = None
    healthCheckUrl: Optional[str] = None


class MCPServerResponse(MCPServerBase):
    id: UUID
    createdAt: datetime
    updatedAt: datetime

    class Config:
        from_attributes = True


# ========== Agent Schemas ==========

class AgentMCPLink(BaseModel):
    mcpId: UUID
    priority: int = 0
    config: dict = Field(default_factory=dict)


class AgentToolLink(BaseModel):
    toolId: UUID
    config: dict = Field(default_factory=dict)


class AgentDocumentationCreate(BaseModel):
    type: str = Field(..., pattern="^(example|guideline|context|changelog)$")
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1)
    orderIndex: int = 0


class AgentBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, pattern="^[a-z][a-z0-9_]*$")
    displayName: str = Field(..., min_length=1, max_length=200)
    description: str = Field(..., min_length=1)
    routeDescription: str = Field(..., min_length=1)
    systemPrompt: Optional[str] = None
    icon: Optional[str] = None
    metadata: dict = Field(default_factory=dict)


class AgentCreate(AgentBase):
    mcps: List[AgentMCPLink] = Field(default_factory=list)
    tools: List[AgentToolLink] = Field(default_factory=list)
    documentation: List[AgentDocumentationCreate] = Field(default_factory=list)


class AgentUpdate(BaseModel):
    displayName: Optional[str] = None
    description: Optional[str] = None
    routeDescription: Optional[str] = None
    systemPrompt: Optional[str] = None
    icon: Optional[str] = None
    metadata: Optional[dict] = None
    state: Optional[AgentState] = None
    changeReason: Optional[str] = None  # For version history


class AgentResponse(AgentBase):
    id: UUID
    state: AgentState
    version: int
    createdAt: datetime
    updatedAt: datetime
    createdBy: Optional[str] = None
    updatedBy: Optional[str] = None
    mcps: List[MCPServerResponse] = []
    tools: List[dict] = []  # Simplified tool info
    documentationCount: int = 0

    class Config:
        from_attributes = True


class AgentListResponse(BaseModel):
    items: List[AgentResponse]
    total: int
    page: int
    pageSize: int


class AgentVersionResponse(BaseModel):
    id: UUID
    version: int
    snapshot: dict
    changeReason: Optional[str]
    changedBy: Optional[str]
    createdAt: datetime
```

### 3. FastAPI Routes

```python
# src/control_layer/routes/agents.py

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.control_layer import crud, schemas
from src.control_layer.database import get_db

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get("/", response_model=schemas.AgentListResponse)
async def list_agents(
    state: Optional[schemas.AgentState] = None,
    search: Optional[str] = Query(None, min_length=1),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """
    List all agents with optional filtering.

    - **state**: Filter by lifecycle state
    - **search**: Search in name and description
    - **page**: Page number (1-indexed)
    - **page_size**: Items per page (max 100)
    """
    agents, total = await crud.list_agents(
        db,
        state=state,
        search=search,
        offset=(page - 1) * page_size,
        limit=page_size,
    )
    return schemas.AgentListResponse(
        items=agents,
        total=total,
        page=page,
        pageSize=page_size,
    )


@router.post("/", response_model=schemas.AgentResponse, status_code=201)
async def create_agent(
    agent: schemas.AgentCreate,
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new agent.

    Agents are created in `draft` state by default.
    Set state to `active` to enable routing.
    """
    try:
        return await crud.create_agent(db, agent)
    except crud.DuplicateError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.get("/{agent_id}", response_model=schemas.AgentResponse)
async def get_agent(
    agent_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get agent details by ID."""
    agent = await crud.get_agent(db, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.put("/{agent_id}", response_model=schemas.AgentResponse)
async def update_agent(
    agent_id: UUID,
    update: schemas.AgentUpdate,
    db: AsyncSession = Depends(get_db),
):
    """
    Update an agent.

    Provide `changeReason` for meaningful version history.
    Version is automatically incremented.
    """
    agent = await crud.update_agent(db, agent_id, update)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.delete("/{agent_id}", status_code=204)
async def delete_agent(
    agent_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Delete an agent.

    This is a hard delete. Consider archiving instead
    by setting state to `archived`.
    """
    deleted = await crud.delete_agent(db, agent_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Agent not found")


@router.get("/{agent_id}/versions", response_model=list[schemas.AgentVersionResponse])
async def get_agent_versions(
    agent_id: UUID,
    limit: int = Query(10, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Get version history for an agent."""
    versions = await crud.get_agent_versions(db, agent_id, limit=limit)
    return versions


@router.post("/{agent_id}/restore", response_model=schemas.AgentResponse)
async def restore_agent_version(
    agent_id: UUID,
    version: int = Query(..., ge=1),
    db: AsyncSession = Depends(get_db),
):
    """
    Restore an agent to a previous version.

    Creates a new version with the restored configuration.
    """
    agent = await crud.restore_agent_version(db, agent_id, version)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent or version not found")
    return agent
```

### 4. CRUD Operations

```python
# src/control_layer/crud.py

from typing import List, Optional, Tuple
from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.control_layer import models, schemas


class DuplicateError(Exception):
    pass


async def list_agents(
    db: AsyncSession,
    state: Optional[schemas.AgentState] = None,
    search: Optional[str] = None,
    offset: int = 0,
    limit: int = 20,
) -> Tuple[List[models.Agent], int]:
    """List agents with filtering and pagination."""
    query = select(models.Agent).options(
        selectinload(models.Agent.mcps).selectinload(models.AgentMCP.mcp),
        selectinload(models.Agent.tools).selectinload(models.AgentTool.tool),
    )

    # Apply filters
    if state:
        query = query.where(models.Agent.state == state)

    if search:
        search_filter = f"%{search}%"
        query = query.where(
            models.Agent.name.ilike(search_filter) |
            models.Agent.description.ilike(search_filter)
        )

    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.scalar(count_query)

    # Apply pagination
    query = query.offset(offset).limit(limit).order_by(models.Agent.name)
    result = await db.execute(query)
    agents = result.scalars().all()

    return agents, total


async def create_agent(
    db: AsyncSession,
    agent_data: schemas.AgentCreate,
) -> models.Agent:
    """Create a new agent with relationships."""
    # Check for duplicate name
    existing = await db.execute(
        select(models.Agent).where(models.Agent.name == agent_data.name)
    )
    if existing.scalar():
        raise DuplicateError(f"Agent with name '{agent_data.name}' already exists")

    # Create agent
    agent = models.Agent(
        name=agent_data.name,
        display_name=agent_data.displayName,
        description=agent_data.description,
        route_description=agent_data.routeDescription,
        system_prompt=agent_data.systemPrompt,
        icon=agent_data.icon,
        metadata=agent_data.metadata,
    )
    db.add(agent)

    # Add MCP links
    for mcp_link in agent_data.mcps:
        agent_mcp = models.AgentMCP(
            agent_id=agent.id,
            mcp_id=mcp_link.mcpId,
            priority=mcp_link.priority,
            config=mcp_link.config,
        )
        db.add(agent_mcp)

    # Add tool links
    for tool_link in agent_data.tools:
        agent_tool = models.AgentTool(
            agent_id=agent.id,
            tool_id=tool_link.toolId,
            config=tool_link.config,
        )
        db.add(agent_tool)

    # Add documentation
    for doc in agent_data.documentation:
        agent_doc = models.AgentDocumentation(
            agent_id=agent.id,
            type=doc.type,
            title=doc.title,
            content=doc.content,
            order_index=doc.orderIndex,
        )
        db.add(agent_doc)

    await db.commit()
    await db.refresh(agent)
    return agent


async def update_agent(
    db: AsyncSession,
    agent_id: UUID,
    update: schemas.AgentUpdate,
) -> Optional[models.Agent]:
    """Update an agent and create version history."""
    agent = await get_agent(db, agent_id)
    if not agent:
        return None

    # Create version snapshot before update
    snapshot = {
        "name": agent.name,
        "displayName": agent.display_name,
        "description": agent.description,
        "routeDescription": agent.route_description,
        "systemPrompt": agent.system_prompt,
        "icon": agent.icon,
        "state": agent.state.value,
        "metadata": agent.metadata,
    }

    version = models.AgentVersion(
        agent_id=agent.id,
        version=agent.version,
        snapshot=snapshot,
        change_reason=update.changeReason,
        changed_by=None,  # TODO: Get from auth context
    )
    db.add(version)

    # Apply updates
    update_data = update.model_dump(exclude_unset=True, exclude={"changeReason"})
    for field, value in update_data.items():
        if field == "displayName":
            agent.display_name = value
        elif field == "routeDescription":
            agent.route_description = value
        elif hasattr(agent, field):
            setattr(agent, field, value)

    # Increment version
    agent.version += 1

    await db.commit()
    await db.refresh(agent)
    return agent


async def get_agent(db: AsyncSession, agent_id: UUID) -> Optional[models.Agent]:
    """Get agent by ID with relationships loaded."""
    query = select(models.Agent).where(models.Agent.id == agent_id).options(
        selectinload(models.Agent.mcps).selectinload(models.AgentMCP.mcp),
        selectinload(models.Agent.tools).selectinload(models.AgentTool.tool),
    )
    result = await db.execute(query)
    return result.scalar()


async def delete_agent(db: AsyncSession, agent_id: UUID) -> bool:
    """Delete an agent by ID."""
    agent = await db.get(models.Agent, agent_id)
    if not agent:
        return False

    await db.delete(agent)
    await db.commit()
    return True


async def get_agent_versions(
    db: AsyncSession,
    agent_id: UUID,
    limit: int = 10,
) -> List[models.AgentVersion]:
    """Get version history for an agent."""
    query = (
        select(models.AgentVersion)
        .where(models.AgentVersion.agent_id == agent_id)
        .order_by(models.AgentVersion.version.desc())
        .limit(limit)
    )
    result = await db.execute(query)
    return result.scalars().all()


async def restore_agent_version(
    db: AsyncSession,
    agent_id: UUID,
    version: int,
) -> Optional[models.Agent]:
    """Restore an agent to a previous version."""
    # Find the version
    query = select(models.AgentVersion).where(
        models.AgentVersion.agent_id == agent_id,
        models.AgentVersion.version == version,
    )
    result = await db.execute(query)
    version_record = result.scalar()

    if not version_record:
        return None

    # Update agent from snapshot
    agent = await db.get(models.Agent, agent_id)
    if not agent:
        return None

    # Create new version for the restore
    restore_update = schemas.AgentUpdate(
        displayName=version_record.snapshot.get("displayName"),
        description=version_record.snapshot.get("description"),
        routeDescription=version_record.snapshot.get("routeDescription"),
        systemPrompt=version_record.snapshot.get("systemPrompt"),
        icon=version_record.snapshot.get("icon"),
        metadata=version_record.snapshot.get("metadata"),
        changeReason=f"Restored from version {version}",
    )

    return await update_agent(db, agent_id, restore_update)
```

### 5. Application Setup

```python
# src/control_layer/app.py

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.control_layer.routes import agents, mcps, tools, bulk

app = FastAPI(
    title="Agent Control Layer API",
    description="REST API for managing agents, MCPs, and tools",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS for admin UI
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(agents.router, prefix="/api/v1")
app.include_router(mcps.router, prefix="/api/v1")
app.include_router(tools.router, prefix="/api/v1")
app.include_router(bulk.router, prefix="/api/v1")


@app.get("/health")
async def health_check():
    return {"status": "healthy"}
```

## Technical Details

### Files to Create

| File | Description |
|------|-------------|
| `src/control_layer/app.py` | FastAPI application |
| `src/control_layer/schemas.py` | Pydantic schemas |
| `src/control_layer/crud.py` | Database operations |
| `src/control_layer/database.py` | DB session dependency |
| `src/control_layer/routes/agents.py` | Agent endpoints |
| `src/control_layer/routes/mcps.py` | MCP endpoints |
| `src/control_layer/routes/tools.py` | Tool endpoints |
| `src/control_layer/routes/bulk.py` | Import/export endpoints |

### Dependencies

Add to `pyproject.toml`:
```toml
dependencies = [
    "fastapi>=0.109.0",
    "uvicorn[standard]>=0.27.0",
    # ... existing deps ...
]
```

### Running the API

```bash
# Start API server (separate from Chainlit)
uv run uvicorn src.control_layer.app:app --port 8001

# Or add to Makefile
api:
    uv run uvicorn src.control_layer.app:app --port 8001 --reload
```

## Acceptance Criteria

- [ ] Full CRUD for agents, MCPs, tools
- [ ] Pagination and filtering for list endpoints
- [ ] Version history tracked on updates
- [ ] Restore to previous version works
- [ ] Bulk import/export for migration
- [ ] OpenAPI documentation at /docs
- [ ] Unit tests for CRUD operations
- [ ] Integration tests for API endpoints

## Testing Strategy

### Unit Tests
```python
async def test_create_agent_crud():
    agent = await crud.create_agent(db, schemas.AgentCreate(
        name="test_agent",
        displayName="Test Agent",
        description="Test",
        routeDescription="Test routing",
    ))
    assert agent.state == AgentState.DRAFT
    assert agent.version == 1

async def test_duplicate_agent_raises_error():
    await crud.create_agent(db, ...)
    with pytest.raises(crud.DuplicateError):
        await crud.create_agent(db, ...)  # Same name
```

### API Tests
```python
async def test_list_agents_with_filter(client):
    response = await client.get("/api/v1/agents?state=active")
    assert response.status_code == 200
    assert all(a["state"] == "active" for a in response.json()["items"])

async def test_create_agent(client):
    response = await client.post("/api/v1/agents", json={
        "name": "new_agent",
        "displayName": "New Agent",
        "description": "A new agent",
        "routeDescription": "Route here",
    })
    assert response.status_code == 201
    assert response.json()["name"] == "new_agent"
```

## Dependencies

- Blocked by: #3.1 Database Schema
- Blocks: #3.3 Lifecycle State Machine, #3.4 Dynamic Loader

## Out of Scope

- Authentication/authorization (use API gateway)
- Rate limiting (use API gateway)
- Admin UI (separate project)
- WebSocket for real-time updates
