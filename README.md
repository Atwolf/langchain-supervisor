# LangChain Supervisor

A multiagent framework using a supervisor agent that dynamically routes user queries to specialized sub-agents based on their capabilities.

## Features

- **Intelligent Query Routing**: Supervisor agent analyzes user messages and delegates to the appropriate specialized agent
- **Agent Mode Picker**: Users can select "Auto" for intelligent routing or directly choose a specific agent
- **MCP Server Integration**: Agents can use external tools via Model Context Protocol servers
- **Chainlit UI**: Conversational interface with custom agent cards and starter prompts
- **Copilot Widget**: Embeddable widget for integration into external websites

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Chainlit UI                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Agent Cards │  │ Mode Picker │  │  Starter Prompts    │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Supervisor Agent                         │
│         (Routes queries based on route_description)         │
└─────────────────────────────────────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │ Math Agent  │ │Weather Agent│ │ Movie Agent │
    │             │ │             │ │             │
    │ [add, mult] │ │[get_weather]│ │ [MCP tools] │
    └─────────────┘ └─────────────┘ └─────────────┘
```

### Supervisor Pattern

A single supervisor `create_react_agent` receives all user messages. It has one `StructuredTool` per sub-agent, where each tool's description is the agent's `route_description`. The supervisor decides which agent to invoke based on the user's query.

### Agent Registration

Agents are defined as `AgentRecord` dataclass instances in `src/agents/default_agents.py` and exported via the `AGENTS` list. The Chainlit app dynamically imports this list and builds the graph at startup.

```python
@dataclass
class AgentRecord:
    name: str                # Unique identifier
    description: str         # Shown in UI
    route_description: str   # Used by supervisor for routing
    tools: tuple             # LangChain tools
    mcps: tuple              # MCP server paths
    icon: str                # Lucide icon name
```

### MCP Server Integration

Agents can specify external tool sources via the `mcps` field. MCP servers use `FastMCP` from the `mcp` library. The `MultiServerMCPClient` from `langchain-mcp-adapters` manages connections and converts MCP tools to LangChain-compatible tools.

## Tech Stack

- **Python 3.12+** with uv package manager
- **LangGraph** for agent orchestration (`create_react_agent`)
- **LangChain Anthropic** (`ChatAnthropic`)
- **Claude claude-sonnet-4-5-20250514** for all agents
- **Chainlit** for conversational UI
- **MCP** (Model Context Protocol) for external tool servers
- **langchain-mcp-adapters** for MCP-to-LangChain tool conversion
- **PyJWT** for copilot widget authentication

## Getting Started

### Prerequisites

- Python 3.12+
- [uv](https://github.com/astral-sh/uv) package manager
- Anthropic API key

### Installation

```bash
# Clone the repository
git clone https://github.com/Atwolf/langchain-supervisor.git
cd langchain-supervisor

# Install dependencies
uv sync

# Set up environment variables
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY
```

### Running the App

```bash
# Start the Chainlit app
uv run chainlit run chainlit_app.py
```

The app will be available at http://localhost:8000

### Running the Copilot Widget

```bash
# Generate a JWT token for authentication
uv run python scripts/generate_token.py <user_id> <name>

# Serve the widget website
cd website && python -m http.server 3000
```

## Project Structure

```
langchain-supervisor/
├── chainlit_app.py              # Main app: supervisor graph + Chainlit handlers
├── src/
│   ├── agents/
│   │   ├── models.py            # AgentRecord dataclass
│   │   ├── default_agents.py    # Agent definitions
│   │   └── __init__.py          # Exports AGENTS list
│   └── middleware/
│       └── chainlit_middleware_tracer.py  # Tool call tracing
├── mcps/
│   └── movies/
│       └── server.py            # MCP server for movie data
├── public/
│   ├── elements/
│   │   └── AgentCards.jsx       # Custom UI component
│   └── auto-icon.svg            # Auto mode icon
├── website/
│   └── index.html               # Copilot widget embed page
└── scripts/
    └── generate_token.py        # JWT token generator
```

## Adding a New Agent

1. Define the agent in `src/agents/default_agents.py`:

```python
my_agent = AgentRecord(
    name="my_agent",
    description="Description shown in the UI",
    route_description="When to route queries to this agent",
    tools=(my_tool_1, my_tool_2),
    mcps=(),  # Or paths to MCP servers
    icon="icon-name",  # Lucide icon
)
```

2. Add it to the `AGENTS` list in the same file.

3. The supervisor will automatically include it in routing decisions.

## License

MIT
