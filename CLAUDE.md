# LangChain Supervisor Exploration

## Project Overview
A multiagent framework using a supervisor agent that dynamically routes user queries to specialized sub-agents based on their `route_description` attributes.

## Tech Stack
- Python 3.12+ with uv
- LangGraph for agent orchestration (`create_react_agent`)
- LangChain Anthropic (`ChatAnthropic`)
- Anthropic Claude claude-sonnet-4-5-20250514 (sub-agents and supervisor)
- Chainlit for conversational UI
- MCP (Model Context Protocol) for external tool servers
- langchain-mcp-adapters (`MultiServerMCPClient`) for MCP-to-LangChain tool conversion
- PyJWT for copilot widget authentication

## Architecture

### Supervisor Pattern (current)
A single supervisor `create_react_agent` receives all user messages. It has one `StructuredTool` per sub-agent, where each tool's `description` is the agent's `route_description`. The supervisor decides which tool (sub-agent) to invoke based on the user's query.

### Agent Registration
Agents are defined as `AgentRecord` dataclass instances in `src/agents/default_agents.py` and exported via `AGENTS` list. The Chainlit app dynamically imports this list and builds the graph at startup — no hardcoded routing logic.

### Key Files
- `src/agents/models.py` — `AgentRecord` dataclass (name, description, route_description, tools, mcps)
- `src/agents/default_agents.py` — concrete agent definitions (math_agent, weather_agent, movie_agent)
- `src/agents/__init__.py` — re-exports `AGENTS`
- `src/middleware/chainlit_middleware_tracer.py` — Chainlit middleware for tool call tracing
- `mcps/movies/server.py` — MCP server for movie data (using FastMCP)
- `chainlit_app.py` — supervisor graph construction and Chainlit message handler
- `public/elements/AgentCards.jsx` — custom Chainlit UI component for displaying agents
- `website/index.html` — copilot widget embed page
- `scripts/generate_token.py` — JWT token generator for copilot authentication

### MCP Server Integration
Agents can specify external tool sources via the `mcps` field in `AgentRecord`. MCP servers use `FastMCP` from the `mcp` library for simplified tool definition.

The `MultiServerMCPClient` from `langchain-mcp-adapters` manages connections to multiple MCP servers and converts their tools to LangChain-compatible tools. Servers are started as subprocesses via stdio transport when the Chainlit app starts (`@cl.on_chat_start`).

### Custom UI Elements
On chat start, agent cards are displayed using Chainlit's `CustomElement` feature with a React component (`public/elements/AgentCards.jsx`). The component uses a compact layout optimized for the copilot widget, showing each agent's name and description with a prompt explaining automatic query routing.

### Copilot Widget
A standalone website (`website/index.html`) embeds the Chainlit copilot widget for integration into external pages. JWT authentication is supported via `CHAINLIT_AUTH_SECRET` in `.env`.

### Middleware for Chainlit Tracing
`ChainlitMiddlewareTracer` is a LangChain middleware that wraps tool calls as Chainlit Steps, providing real-time visibility of tool invocations in the Chainlit UI. It is passed to all `create_agent()` calls.

### Model Decisions
- **Supervisor LLM**: claude-sonnet-4-5-20250514 — chosen for fast tool-calling with good routing accuracy
- **Sub-agent LLM**: same model, each sub-agent uses `create_react_agent` with its own tool list

## Commands
- `uv run chainlit run chainlit_app.py` - Run the Chainlit app
- `uv run pytest` - Run tests
- `cd website && python -m http.server 3000` - Serve copilot widget website
- `uv run python scripts/generate_token.py [user] [name]` - Generate JWT for copilot auth

## Rules
- When making model or architecture decisions (e.g. changing LLM, adding agents, altering routing strategy), update this file's Architecture and Model Decisions sections accordingly.
