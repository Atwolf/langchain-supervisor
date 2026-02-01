# [Feature] Dynamic agent loader with hot-reload

**Labels**: `feature`, `control-plane`, `effort-l`

**Part of**: [Epic] Agent Control Layer (#3.0)

---

## Summary

Implement a dynamic agent loader that watches for database changes and hot-reloads agents at runtime without requiring service restarts.

## Context

Agents are currently loaded once at startup from static Python code.

**Current Loading** (`chainlit_app.py:147-198`):
```python
@cl.on_chat_start
async def on_chat_start():
    """Initialize MCP servers and build the graph on chat start."""
    # Static agent loading from AGENTS list
    supervisor, sub_agents = build_agents(
        AGENTS, mcp_tools=mcp_tools, middleware=middleware
    )
    cl.user_session.set("supervisor", supervisor)
    cl.user_session.set("sub_agents", sub_agents)
```

**Limitations**:
- New agents require service restart
- No way to disable agents without code change
- MCP connection lifecycle not managed

## Problem Statement

With agents in the database (#3.1) and an API for management (#3.2, #3.3), we need:

1. **Initial load from DB** - Replace static `AGENTS` list
2. **Change detection** - Know when agents are updated
3. **Hot reload** - Rebuild supervisor without restart
4. **MCP lifecycle** - Connect/disconnect MCP servers dynamically

## Proposed Solution

### 1. Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                    Dynamic Agent Loader                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐ │
│  │ DB Watcher  │───▶│ Agent Cache │───▶│ Supervisor Builder  │ │
│  │ (polling)   │    │ (in-memory) │    │ (hot-reload)        │ │
│  └─────────────┘    └─────────────┘    └─────────────────────┘ │
│         ▲                                       │               │
│         │                                       ▼               │
│    PostgreSQL                           Chainlit Sessions       │
│   (agents table)                        (supervisor update)     │
└────────────────────────────────────────────────────────────────┘
```

### 2. Agent Loader Service

```python
# src/control_layer/loader.py

import asyncio
from datetime import datetime
from typing import Callable, Dict, List, Optional
from uuid import UUID

from langchain.agents import create_agent
from langchain_anthropic import ChatAnthropic
from langchain_core.tools import StructuredTool
from langchain_mcp_adapters.client import MultiServerMCPClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.control_layer.models import Agent, AgentState, AgentMCP, MCPServer
from src.middleware import ChainlitMiddlewareTracer


class LoadedAgent:
    """Represents a loaded and ready-to-use agent."""

    def __init__(
        self,
        record: Agent,
        runnable: any,  # LangGraph agent
        tools: List[any],
        mcp_client: Optional[MultiServerMCPClient] = None,
    ):
        self.id = record.id
        self.name = record.name
        self.description = record.description
        self.route_description = record.route_description
        self.icon = record.icon
        self.runnable = runnable
        self.tools = tools
        self.mcp_client = mcp_client
        self.loaded_at = datetime.utcnow()
        self.version = record.version


class DynamicAgentLoader:
    """
    Manages dynamic loading and hot-reloading of agents.

    Features:
    - Load agents from database
    - Watch for changes and reload
    - Manage MCP server connections
    - Build supervisor with active agents
    """

    def __init__(
        self,
        db_session_factory: Callable[[], AsyncSession],
        llm_model: str = "claude-sonnet-4-5-20250514",
        poll_interval: int = 30,  # seconds
    ):
        self.db_session_factory = db_session_factory
        self.llm_model = llm_model
        self.poll_interval = poll_interval

        # In-memory cache
        self._agents: Dict[UUID, LoadedAgent] = {}
        self._supervisor = None
        self._last_check: Optional[datetime] = None
        self._running = False

        # Callbacks for notifying of changes
        self._on_reload_callbacks: List[Callable] = []

    @property
    def agents(self) -> Dict[str, LoadedAgent]:
        """Get all loaded agents keyed by name."""
        return {a.name: a for a in self._agents.values()}

    @property
    def supervisor(self):
        """Get the current supervisor agent."""
        return self._supervisor

    def on_reload(self, callback: Callable):
        """Register callback to be called when agents are reloaded."""
        self._on_reload_callbacks.append(callback)

    async def start(self):
        """Start the loader and begin watching for changes."""
        await self._initial_load()
        self._running = True
        asyncio.create_task(self._watch_loop())

    async def stop(self):
        """Stop the loader and clean up resources."""
        self._running = False
        await self._cleanup_all_agents()

    async def _initial_load(self):
        """Load all active agents from database."""
        async with self.db_session_factory() as db:
            agents = await self._fetch_active_agents(db)

        for agent_record in agents:
            await self._load_agent(agent_record)

        await self._build_supervisor()
        self._last_check = datetime.utcnow()

    async def _watch_loop(self):
        """Poll for changes and reload as needed."""
        while self._running:
            await asyncio.sleep(self.poll_interval)

            try:
                async with self.db_session_factory() as db:
                    # Check for changes since last poll
                    changes = await self._check_for_changes(db)

                if changes:
                    await self._apply_changes(changes)
                    await self._notify_reload()

            except Exception as e:
                import logging
                logging.error(f"Agent loader watch error: {e}")

    async def _fetch_active_agents(self, db: AsyncSession) -> List[Agent]:
        """Fetch all active agents with relationships."""
        query = (
            select(Agent)
            .where(Agent.state == AgentState.ACTIVE)
            .options(
                selectinload(Agent.mcps).selectinload(AgentMCP.mcp),
                selectinload(Agent.tools).selectinload(AgentTool.tool),
            )
        )
        result = await db.execute(query)
        return result.scalars().all()

    async def _check_for_changes(self, db: AsyncSession) -> Dict:
        """
        Check for agent changes since last poll.

        Returns dict with 'added', 'removed', 'updated' lists.
        """
        current_agents = await self._fetch_active_agents(db)
        current_ids = {a.id for a in current_agents}
        loaded_ids = set(self._agents.keys())

        changes = {
            "added": [],
            "removed": [],
            "updated": [],
        }

        # Find new agents
        for agent in current_agents:
            if agent.id not in loaded_ids:
                changes["added"].append(agent)
            elif agent.version > self._agents[agent.id].version:
                changes["updated"].append(agent)

        # Find removed agents (deactivated)
        for agent_id in loaded_ids:
            if agent_id not in current_ids:
                changes["removed"].append(agent_id)

        return changes

    async def _apply_changes(self, changes: Dict):
        """Apply detected changes to loaded agents."""
        # Remove deactivated agents
        for agent_id in changes["removed"]:
            await self._unload_agent(agent_id)

        # Add new agents
        for agent in changes["added"]:
            await self._load_agent(agent)

        # Reload updated agents
        for agent in changes["updated"]:
            await self._unload_agent(agent.id)
            await self._load_agent(agent)

        # Rebuild supervisor if anything changed
        if any(changes.values()):
            await self._build_supervisor()

    async def _load_agent(self, agent_record: Agent):
        """Load a single agent with its tools and MCPs."""
        tools = []
        mcp_client = None

        # Load static tools
        for agent_tool in agent_record.tools:
            tool_record = agent_tool.tool
            try:
                # Dynamic import
                import importlib
                module = importlib.import_module(tool_record.module_path)
                tool_fn = getattr(module, tool_record.function_name)
                tools.append(tool_fn)
            except Exception as e:
                import logging
                logging.error(f"Failed to load tool {tool_record.name}: {e}")

        # Connect to MCP servers
        if agent_record.mcps:
            mcp_config = {}
            for agent_mcp in agent_record.mcps:
                mcp = agent_mcp.mcp
                if mcp.transport.value == "stdio":
                    mcp_config[mcp.name] = {
                        "command": mcp.command,
                        "args": mcp.args or [],
                        "transport": "stdio",
                        "env": mcp.env or {},
                    }
                elif mcp.transport.value in ("sse", "websocket"):
                    mcp_config[mcp.name] = {
                        "url": mcp.url,
                        "transport": mcp.transport.value,
                    }

            if mcp_config:
                try:
                    mcp_client = MultiServerMCPClient(mcp_config)
                    mcp_tools = await mcp_client.get_tools()
                    tools.extend(mcp_tools)
                except Exception as e:
                    import logging
                    logging.error(f"Failed to connect MCP for {agent_record.name}: {e}")

        # Create the LangGraph agent
        llm = ChatAnthropic(model=self.llm_model)
        middleware = [ChainlitMiddlewareTracer(agent_name=agent_record.name)]

        system_prompt = agent_record.system_prompt or (
            f"You are the {agent_record.display_name}. {agent_record.description}"
        )

        runnable = create_agent(
            llm,
            tools=tools,
            system_prompt=system_prompt,
            middleware=middleware,
        )

        loaded = LoadedAgent(
            record=agent_record,
            runnable=runnable,
            tools=tools,
            mcp_client=mcp_client,
        )

        self._agents[agent_record.id] = loaded
        import logging
        logging.info(f"Loaded agent: {agent_record.name} (v{agent_record.version})")

    async def _unload_agent(self, agent_id: UUID):
        """Unload an agent and clean up its resources."""
        if agent_id not in self._agents:
            return

        loaded = self._agents[agent_id]

        # Close MCP connections
        if loaded.mcp_client:
            try:
                # MultiServerMCPClient cleanup
                pass  # TODO: Implement proper cleanup
            except Exception as e:
                import logging
                logging.warning(f"MCP cleanup error: {e}")

        del self._agents[agent_id]
        import logging
        logging.info(f"Unloaded agent: {loaded.name}")

    async def _cleanup_all_agents(self):
        """Clean up all loaded agents."""
        for agent_id in list(self._agents.keys()):
            await self._unload_agent(agent_id)

    async def _build_supervisor(self):
        """Build supervisor agent with current active agents."""
        if not self._agents:
            self._supervisor = None
            return

        llm = ChatAnthropic(model=self.llm_model)

        # Build routing tools for supervisor
        supervisor_tools = []
        for loaded in self._agents.values():
            async def delegate(query: str, agent=loaded) -> str:
                """Delegate a query to this agent."""
                result = await agent.runnable.ainvoke(
                    {"messages": [{"role": "user", "content": query}]}
                )
                ai_messages = [
                    m for m in result["messages"]
                    if m.type == "ai" and m.content
                ]
                return ai_messages[-1].content if ai_messages else "No response."

            tool = StructuredTool.from_function(
                coroutine=delegate,
                name=loaded.name,
                description=loaded.route_description,
            )
            supervisor_tools.append(tool)

        # Build supervisor prompt
        agent_descriptions = "\n".join(
            f"- **{a.name}**: {a.route_description}"
            for a in self._agents.values()
        )

        supervisor_prompt = (
            "You are a supervisor agent that routes user queries to specialized sub-agents.\n"
            "Analyze the user's message and decide which agent to delegate to.\n"
            "If no agent is appropriate, respond directly.\n\n"
            "## Available Agents\n"
            f"{agent_descriptions}\n\n"
            "To delegate, call the appropriate agent tool with the user's query."
        )

        middleware = [ChainlitMiddlewareTracer(agent_name="supervisor")]

        self._supervisor = create_agent(
            llm,
            tools=supervisor_tools,
            system_prompt=supervisor_prompt,
            middleware=middleware,
        )

        import logging
        logging.info(f"Supervisor rebuilt with {len(self._agents)} agents")

    async def _notify_reload(self):
        """Notify all registered callbacks of reload."""
        for callback in self._on_reload_callbacks:
            try:
                if asyncio.iscoroutinefunction(callback):
                    await callback()
                else:
                    callback()
            except Exception as e:
                import logging
                logging.error(f"Reload callback error: {e}")

    # ========== Manual reload methods ==========

    async def force_reload(self):
        """Force a full reload of all agents."""
        await self._cleanup_all_agents()
        await self._initial_load()
        await self._notify_reload()

    async def reload_agent(self, agent_id: UUID):
        """Reload a specific agent."""
        async with self.db_session_factory() as db:
            agent = await db.get(Agent, agent_id)
            if agent and agent.state == AgentState.ACTIVE:
                await self._unload_agent(agent_id)
                await self._load_agent(agent)
                await self._build_supervisor()
                await self._notify_reload()
```

### 3. Integration with Chainlit

```python
# chainlit_app.py (updated)

import os
from typing import Optional

import chainlit as cl
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from src.control_layer.loader import DynamicAgentLoader

# Global loader instance
_loader: Optional[DynamicAgentLoader] = None


def get_loader() -> DynamicAgentLoader:
    global _loader
    if _loader is None:
        raise RuntimeError("Agent loader not initialized")
    return _loader


async def get_db_session():
    engine = create_async_engine(os.environ["DATABASE_URL"])
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        yield session


@cl.on_chat_start
async def on_chat_start():
    """Initialize or get agents from the dynamic loader."""
    global _loader

    # Initialize loader on first request (singleton)
    if _loader is None:
        _loader = DynamicAgentLoader(
            db_session_factory=lambda: get_db_session().__anext__(),
            llm_model=os.environ.get("LLM_MODEL", "claude-sonnet-4-5-20250514"),
            poll_interval=int(os.environ.get("AGENT_POLL_INTERVAL", "30")),
        )
        await _loader.start()

        # Register reload callback to update active sessions
        _loader.on_reload(lambda: print("Agents reloaded!"))

    loader = get_loader()

    # Store in session for message handler
    cl.user_session.set("supervisor", loader.supervisor)
    cl.user_session.set("sub_agents", loader.agents)

    # Set up agent mode picker with current agents
    mode_options = [
        cl.ModeOption(
            id="auto",
            name="Auto",
            icon="/public/auto-icon.svg",
            description="Intelligently select the right agent.",
            default=True,
        ),
    ]

    for agent in loader.agents.values():
        mode_options.append(
            cl.ModeOption(
                id=agent.name,
                name=agent.name.replace("_", " ").title(),
                description=agent.description,
                icon=agent.icon,
            )
        )

    agent_mode = cl.Mode(id="agent", name="Agent", options=mode_options)
    await cl.context.emitter.set_modes([agent_mode])

    # Build and send agent cards
    agents_data = {
        "starters": STARTERS,
        "agents": [
            {
                "name": a.name.replace("_", " ").title(),
                "description": a.description,
                "icon": a.icon,
                "tools": [{"name": t.name, "description": t.description} for t in a.tools],
            }
            for a in loader.agents.values()
        ],
    }

    agent_cards = cl.CustomElement(name="AgentCards", props=agents_data)
    await cl.Message(content="", elements=[agent_cards]).send()


@cl.on_message
async def on_message(message: cl.Message):
    loader = get_loader()
    supervisor = loader.supervisor
    sub_agents = loader.agents

    if not supervisor:
        await cl.Message(content="Error: No agents available.").send()
        return

    # Get selected agent mode
    selected_agent = (message.modes or {}).get("agent", "auto")

    if selected_agent == "auto":
        agent = supervisor
    else:
        agent = sub_agents.get(selected_agent)
        if not agent:
            await cl.Message(content=f"Error: Agent '{selected_agent}' not available.").send()
            return
        agent = agent.runnable

    result = await agent.ainvoke(
        {"messages": [{"role": "user", "content": message.content}]}
    )
    ai_messages = [m for m in result["messages"] if m.type == "ai" and m.content]
    response = ai_messages[-1].content if ai_messages else "No response."
    await cl.Message(content=response).send()


@cl.on_chat_end
async def on_chat_end():
    """Cleanup on session end."""
    # Individual sessions don't need cleanup since loader is shared
    pass
```

### 4. Event-Driven Reloading

```python
# src/control_layer/events.py (extended)

from src.control_layer.loader import DynamicAgentLoader

_loader_instance: DynamicAgentLoader = None


def set_loader_instance(loader: DynamicAgentLoader):
    global _loader_instance
    _loader_instance = loader


# Subscribe to state change events
async def on_agent_activated(data: dict):
    """Handle agent activation event."""
    if _loader_instance:
        await _loader_instance.reload_agent(data["agent_id"])


async def on_agent_deactivated(data: dict):
    """Handle agent deactivation event."""
    if _loader_instance:
        await _loader_instance.force_reload()


# Register event handlers
subscribe("agent.activated", on_agent_activated)
subscribe("agent.deactivated", on_agent_deactivated)
```

## Technical Details

### Files to Create/Modify

| File | Description |
|------|-------------|
| `src/control_layer/loader.py` | Dynamic agent loader |
| `src/control_layer/events.py` | Extend with loader integration |
| `chainlit_app.py` | Integrate dynamic loader |

### Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `AGENT_POLL_INTERVAL` | 30 | Seconds between database polls |
| `AGENT_LOADER_ENABLED` | true | Enable dynamic loading |

### Memory Management

- Agents cached in memory until unloaded
- MCP connections reused until agent reload
- Supervisor rebuilt only when agents change

### Concurrency Considerations

- Loader is singleton across all sessions
- Reload is atomic (old agents remain until new ones ready)
- Session-level access via `cl.user_session`

## Acceptance Criteria

- [ ] Agents loaded from database on startup
- [ ] Changes detected via polling
- [ ] New agents available without restart
- [ ] Deactivated agents removed from routing
- [ ] Updated agents reloaded with new config
- [ ] MCP connections managed properly
- [ ] Supervisor rebuilt on changes
- [ ] Active sessions notified of changes
- [ ] Graceful handling of load failures
- [ ] Unit tests for loader logic
- [ ] Integration tests for hot-reload

## Testing Strategy

### Unit Tests
```python
async def test_initial_load():
    # Mock database with test agents
    # Verify agents loaded into cache

async def test_change_detection():
    # Load initial agents
    # Mock database change
    # Verify change detected

async def test_agent_reload():
    # Load agent v1
    # Update to v2
    # Verify v2 loaded, v1 cleaned up
```

### Integration Tests
- Full flow: create agent via API → verify loaded
- Update agent → verify hot-reloaded
- Deactivate agent → verify removed from routing
- MCP server lifecycle (connect/disconnect)

### Load Tests
- Many concurrent sessions during reload
- Rapid successive changes

## Dependencies

- Blocked by: #3.1 Schema, #3.2 CRUD, #3.3 Lifecycle
- Blocks: None (end of chain)

## Out of Scope

- Distributed loader (multiple instances)
- Agent load balancing
- Circuit breaker for failing agents
- Agent-level rate limiting
- Canary deployments (gradual rollout)
