# LangChain Supervisor Exploration

## Project Overview
A multiagent framework using a supervisor agent that dynamically routes user queries to specialized sub-agents based on their `route_description` attributes.

## Tech Stack
- Python 3.12+ with uv
- LangGraph for agent orchestration (`create_react_agent`)
- LangChain Core (`langchain-core`) for base abstractions
- LangChain Anthropic (`ChatAnthropic`)
- Anthropic Claude claude-sonnet-4-5-20250514 (sub-agents and supervisor)
- Chainlit for conversational UI
- MCP (Model Context Protocol) for external tool servers
- langchain-mcp-adapters (`MultiServerMCPClient`) for MCP-to-LangChain tool conversion
- PyJWT for copilot widget authentication
- python-dotenv for environment variable loading
- httpx for async HTTP requests (OAuth token exchange)
- PostgreSQL 16 with asyncpg for data persistence
- SQLAlchemy 2.0+ with Chainlit's built-in SQLAlchemyDataLayer
- Arize Phoenix (`arize-phoenix-otel`) for LLM observability and tracing
- OpenInference (`openinference-instrumentation-langchain`) for LangChain auto-instrumentation
- Dev tools: black (formatter), pylint (linter)

## Architecture

### Supervisor Pattern (current)
A single supervisor `create_react_agent` receives all user messages. It has one `StructuredTool` per sub-agent, where each tool's `description` is the agent's `route_description`. The supervisor decides which tool (sub-agent) to invoke based on the user's query.

### Agent Mode Picker
Users can select an agent mode via Chainlit's Modes feature. "Auto" (default) uses the supervisor for intelligent routing; selecting a specific agent bypasses the supervisor and routes directly to that agent. Mode options display each agent's icon and description.

### Agent Registration
Agents are defined as `AgentRecord` dataclass instances in `src/agents/default_agents.py` and exported via `AGENTS` list. The Chainlit app dynamically imports this list and builds the graph at startup — no hardcoded routing logic.

### Key Files
- `README.md` — project documentation with architecture overview
- `Makefile` — build automation for starting all services
- `src/agents/models.py` — `AgentRecord` dataclass (name, description, route_description, tools, mcps, icon)
- `src/agents/default_agents.py` — concrete agent definitions (math_agent, weather_agent, movie_agent)
- `src/agents/__init__.py` — re-exports `AGENTS`
- `src/middleware/chainlit_middleware_tracer.py` — Chainlit middleware for tool call tracing
- `src/telemetry/phoenix_setup.py` — Arize Phoenix OpenTelemetry initialization
- `src/datalayer/postgres.py` — PostgreSQL data layer with subagent feedback association
- `src/datalayer/local_storage.py` — Local file storage for element content
- `src/auth/callbacks.py` — authentication callbacks for user identification
- `datalayer/database/docker-compose.yml` — PostgreSQL container configuration
- `datalayer/database/init/01-schema.sql` — Chainlit database schema
- `datalayer/database/init/02-add-subagents-to-feedbacks.sql` — Migration adding subagents column to feedbacks
- `mcps/movies/server.py` — MCP server for movie data (using FastMCP)
- `chainlit_app.py` — supervisor graph construction and Chainlit message handler
- `public/elements/AgentCards.jsx` — custom Chainlit UI component for displaying agents and starter prompts
- `public/auto-icon.svg` — custom gradient sparkle icon for Auto mode
- `website/index.html` — copilot widget embed page
- `scripts/generate_token.py` — JWT token generator for copilot authentication

### MCP Server Integration
Agents can specify external tool sources via the `mcps` field in `AgentRecord`. MCP servers use `FastMCP` from the `mcp` library for simplified tool definition.

The `MultiServerMCPClient` from `langchain-mcp-adapters` manages connections to multiple MCP servers and converts their tools to LangChain-compatible tools. Servers are started as subprocesses via stdio transport when the Chainlit app starts (`@cl.on_chat_start`).

### Custom UI Elements
On chat start, agent cards are displayed using Chainlit's `CustomElement` feature with a React component (`public/elements/AgentCards.jsx`). The component uses a compact layout optimized for the copilot widget, showing each agent's name and description.

**Starter Prompts**: Clickable starter buttons are rendered below the agent cards to help users quickly engage with the system. Starters are defined in `STARTERS` list in `chainlit_app.py` and passed as props to the AgentCards component. Clicking a starter uses Chainlit's `sendUserMessage()` global API (available to custom elements) to send the message directly to the chat.

### Copilot Widget
A standalone website (`website/index.html`) embeds the Chainlit copilot widget for integration into external pages. JWT authentication is supported via `CHAINLIT_AUTH_SECRET` in `.env`.

### Middleware for Chainlit Tracing
`ChainlitMiddlewareTracer` is a LangChain middleware that wraps tool calls as Chainlit Steps, providing real-time visibility of tool invocations in the Chainlit UI. It is passed to all `create_agent()` calls.

### Observability (Arize Phoenix)
All LangChain/LangGraph operations are auto-instrumented via OpenInference's `LangChainInstrumentor`, sending traces to an Arize Phoenix collector. This provides full supervisor-to-subagent trace visibility: when the supervisor delegates to a subagent via tool call, the subagent's execution (including its own tool calls) appears as nested spans under the supervisor's trace.

**Setup**: `init_phoenix_tracing()` is called at module level in `chainlit_app.py` (before any LangChain operations). It registers an OTLP exporter with the Phoenix collector endpoint and instruments LangChain.

**Key Files:**
- `src/telemetry/phoenix_setup.py` — Phoenix/OTel initialization
- `src/telemetry/__init__.py` — Re-exports `init_phoenix_tracing`

**Environment Variables:**
- `PHOENIX_COLLECTOR_ENDPOINT` — Phoenix collector URL (default: `http://localhost:6006/v1/traces`)
- `PHOENIX_PROJECT_NAME` — Project name in Phoenix dashboard (default: `langchain-supervisor`)
- `PHOENIX_TRACING_ENABLED` — Set to `false` to disable tracing (default: `true`)

### Subagent Feedback Association
When a user submits feedback (thumbs up/down) on a message, the feedback record is automatically associated with the subagent(s) that contributed to that response.

**How it works:**
1. `on_message` in `chainlit_app.py` inspects the supervisor's result messages after invocation to identify which subagent tools were called (via `extract_subagents_from_result`)
2. The contributing subagent names are stored in the response message's `metadata.subagents` field
3. `CustomSQLAlchemyDataLayer.upsert_feedback` overrides the base implementation to look up the step's metadata and write the subagent names into the feedback record's `subagents` column
4. The feedbacks table has a `subagents TEXT[]` column with a GIN index for efficient querying

**Example**: A user asks "What's the weather in Paris?" → supervisor delegates to `weather_agent` → response message metadata contains `{"subagents": ["weather_agent"]}` → user gives thumbs up → feedback record gets `subagents = ["weather_agent"]`.

### PostgreSQL Data Layer
The application uses a PostgreSQL database for persistent storage via Chainlit's built-in `SQLAlchemyDataLayer` (with `asyncpg` driver). The data layer is registered using the `@cl.data_layer` decorator in `chainlit_app.py`.

**Persisted Data:**
- **Users**: Identified by username, stores metadata and creation time
- **Threads**: Chat conversations linked to users, with tags and metadata
- **Steps**: Individual messages/tool calls within threads
- **Elements**: File attachments and media (stored via LocalStorageClient)
- **Feedbacks**: User feedback (thumbs up/down) on assistant messages, with subagent association

**Local Storage for Elements:**
`LocalStorageClient` implements Chainlit's `BaseStorageClient` interface to store element content (like CustomElement props) in local files. Files are stored in `public/storage/` and served via Chainlit's `/public/` endpoint. This is required for `CustomElement` to work with `SQLAlchemyDataLayer`.

**Key Files:**
- `src/datalayer/postgres.py` — SQLAlchemy data layer with subagent feedback association
- `src/datalayer/local_storage.py` — Local file storage client for element content
- `datalayer/database/docker-compose.yml` — PostgreSQL container setup
- `datalayer/database/init/01-schema.sql` — Database schema (auto-applied on first start)
- `datalayer/database/init/02-add-subagents-to-feedbacks.sql` — Migration for subagents column

### Authentication
User identification is handled via Chainlit authentication callbacks, required for thread persistence.

**Callbacks:**
- `@cl.password_auth_callback` — Web UI login with username/password
- `@cl.header_auth_callback` — Header-based auth for copilot widget
- `@cl.oauth_callback` — OAuth authentication callback

**OAuth Integration:**
A custom OAuth provider (`PlaygroundOAuthProvider`) enables authentication via the oauth.com playground server for testing OAuth flows. Provider registration follows the Chainlit cookbook pattern using helper functions that validate environment variables and prevent duplicate registration.

- **Authorization URL**: `https://authorization-server.com/authorize`
- **Token URL**: `https://authorization-server.com/token`
- **Scopes**: `photo offline_access`

**Key Files:**
- `src/auth/callbacks.py` — Password authentication callback
- `src/auth/playground_oauth.py` — Custom OAuth provider for oauth.com playground
- `src/auth/inject_custom_auth.py` — Helper functions for safe provider registration (following cookbook pattern)
- `chainlit_app.py` — OAuth callback and provider registration (must register provider before decorator)

**Environment Variables:**
- `CHAINLIT_DEV_AUTH=true` — Accept any credentials (development mode)
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — Production credentials
- `OAUTH_PLAYGROUND_CLIENT_ID` — OAuth playground client ID
- `OAUTH_PLAYGROUND_CLIENT_SECRET` — OAuth playground client secret

### Model Decisions
- **Supervisor LLM**: claude-sonnet-4-5-20250514 — chosen for fast tool-calling with good routing accuracy
- **Sub-agent LLM**: same model, each sub-agent uses `create_react_agent` with its own tool list
- **Observability**: Arize Phoenix via OpenInference — chosen for native LangChain auto-instrumentation and subagent span nesting without manual tracing code
- **Feedback storage**: PostgreSQL `TEXT[]` column on feedbacks table — chosen over JSONB for direct queryability (e.g., `WHERE 'weather_agent' = ANY(subagents)`)

## Commands

### Quick Start (Makefile)
- `make start` - Start all services (database, website, chainlit)
- `make stop` - Stop all services
- `make help` - Show all available commands

### Individual Services
- `make db` - Start PostgreSQL database only
- `make website` - Start website server only (port 3000)
- `make chainlit` - Start Chainlit app only (port 8000, starts db first)

### Database Management
- `make db-shell` - Open psql shell to database
- `make db-logs` - View database logs
- `make db-reset` - Reset database (removes all data)

### Development
- `make install` - Install dependencies
- `make lint` - Run pylint
- `make format` - Format code with black
- `make test` - Run pytest

### Manual Commands
- `uv run chainlit run chainlit_app.py` - Run the Chainlit app
- `uv run pytest` - Run tests
- `cd website && python -m http.server 3000` - Serve copilot widget website
- `uv run python scripts/generate_token.py [user] [name]` - Generate JWT for copilot auth

## Rules
- When making model or architecture decisions (e.g. changing LLM, adding agents, altering routing strategy), update this file's Architecture and Model Decisions sections accordingly.
