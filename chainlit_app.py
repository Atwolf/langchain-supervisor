"""Chainlit entrypoint for supervisor routing and QA JSON collection."""

import os
import traceback
from pathlib import Path
from typing import Dict, Optional

import chainlit as cl
from langchain_anthropic import ChatAnthropic
from langchain.agents import create_agent
from langchain_core.tools import StructuredTool
from langchain_mcp_adapters.client import MultiServerMCPClient

from src.agents import AGENTS
from src.agents.models import AgentRecord
from src.middleware import ChainlitMiddlewareTracer
from src.datalayer import get_data_layer
from src.auth import password_auth_callback  # noqa: F401
from src.auth.inject_custom_auth import add_custom_oauth_provider
from src.auth.playground_oauth import PlaygroundOAuthProvider
from src.qa_wizard import (
    QA_OPTIONS,
    QA_WIZARD_TIMEOUT_SECONDS,
    empty_model,
    model_to_json,
    normalize_model,
)

# Register custom OAuth provider using helper (handles validation and duplicates)
add_custom_oauth_provider("playground", PlaygroundOAuthProvider())


@cl.oauth_callback
def oauth_callback(
    provider_id: str,
    token: str,
    raw_user_data: Dict[str, str],
    default_user: cl.User,
) -> Optional[cl.User]:
    """
    OAuth callback to process authenticated users.

    Called after successful OAuth authentication.
    Returns the user object to be used for the session.
    """
    return default_user


# Register the PostgreSQL data layer for persistent threads and feedback
@cl.data_layer
def data_layer():
    return get_data_layer()


# Wells Fargo red gradient sparkle icon
AUTO_ICON = "/public/auto-icon.svg"


def qa_actions() -> list[cl.Action]:
    """Return actions attached to QA wizard JSON messages."""
    return [
        cl.Action(
            name="qa_restart",
            payload={},
            label="Restart QA Wizard",
            icon="refresh-cw",
        ),
        cl.Action(
            name="qa_show_json",
            payload={},
            label="Show Last JSON",
            icon="braces",
        ),
    ]


async def send_qa_model(model: dict) -> None:
    """Render the generated QA JSON model and action affordances."""
    await cl.Message(
        content=model_to_json(model),
        language="json",
        actions=qa_actions(),
    ).send()


async def send_qa_entrypoint() -> None:
    """Render the QA wizard entrypoint without using composer commands."""
    entrypoint = cl.CustomElement(
        name="QaEntrypoint",
        props={
            "title": "Architecture QA Wizard",
            "description": (
                "Collect system, component, data, messaging, and integration "
                "details into a target JSON model."
            ),
        },
    )
    await cl.Message(
        content="",
        elements=[entrypoint],
    ).send()


async def run_qa_wizard() -> None:
    """Collect architecture QA inputs via a Chainlit custom element."""
    initial_model = cl.user_session.get("qa_model") or empty_model()
    wizard = cl.CustomElement(
        name="QaWizard",
        props={
            "options": QA_OPTIONS,
            "initialModel": initial_model,
        },
    )
    response = await cl.AskElementMessage(
        content="Complete the QA wizard to generate a target architecture JSON model.",
        element=wizard,
        timeout=QA_WIZARD_TIMEOUT_SECONDS,
    ).send()

    if not response or not response.get("submitted"):
        await cl.Message(content="QA wizard cancelled.").send()
        return

    model = normalize_model(response.get("model"))
    cl.user_session.set("qa_model", model)
    await send_qa_model(model)


def build_supervisor_prompt(agents: list[AgentRecord]) -> str:
    """Build the supervisor routing prompt from registered agent metadata."""
    agent_descriptions = "\n".join(
        f"- **{a.name}**: {a.route_description}" for a in agents
    )
    return (
        "You are a supervisor agent that routes user queries to specialized sub-agents.\n"
        "Analyze the user's message and decide which agent to delegate to.\n"
        "If no agent is appropriate, respond directly.\n\n"
        "## Available Agents\n"
        f"{agent_descriptions}\n\n"
        "To delegate, call the appropriate agent tool with the user's query."
    )


def build_agents(
    agents: list[AgentRecord],
    mcp_tools: dict[str, list] = None,
    middleware: list = None,
):
    """Build all agents and return both supervisor and sub-agents."""
    mcp_tools = mcp_tools or {}
    middleware = middleware or []

    llm = ChatAnthropic(model=os.environ.get("LLM_MODEL", "claude-sonnet-4-5-20250514"))

    # Create sub-agent runnables keyed by name
    sub_agents = {}
    for agent in agents:
        # Combine agent's static tools with any MCP tools
        agent_tools = list(agent.tools) + mcp_tools.get(agent.name, [])

        sub_agents[agent.name] = create_agent(
            llm,
            tools=agent_tools,
            system_prompt=f"You are the {agent.name}. {agent.description}",
            middleware=middleware,
        )

    # Build routing tools for the supervisor: one tool per sub-agent
    def _make_delegate_fn(agent_runnable):
        async def delegate(query: str) -> str:
            """Delegate a query to this agent."""
            result = await agent_runnable.ainvoke(
                {"messages": [{"role": "user", "content": query}]}
            )
            # Extract the final AI message content
            ai_messages = [
                m for m in result["messages"] if m.type == "ai" and m.content
            ]
            return ai_messages[-1].content if ai_messages else "No response from agent."

        return delegate

    supervisor_tools = []
    for agent in agents:
        fn = _make_delegate_fn(sub_agents[agent.name])
        tool = StructuredTool.from_function(
            coroutine=fn,
            name=agent.name,
            description=agent.route_description,
        )
        supervisor_tools.append(tool)

    supervisor_prompt = build_supervisor_prompt(agents)
    supervisor = create_agent(
        llm,
        tools=supervisor_tools,
        system_prompt=supervisor_prompt,
        middleware=middleware,
    )
    return supervisor, sub_agents


# Starter prompts for quick user engagement
STARTERS = [
    {
        "label": "Calculate something",
        "message": "What is 25 * 47 + 183?",
        "icon": "calculator",
    },
    {
        "label": "Check weather",
        "message": "What's the weather in San Francisco?",
        "icon": "cloud-sun",
    },
    {
        "label": "Movie info",
        "message": "Tell me about the movie Inception",
        "icon": "film",
    },
    {
        "label": "General question",
        "message": "What can you help me with?",
        "icon": "help",
    },
]


@cl.on_chat_start
async def on_chat_start():
    """Initialize MCP servers and build the graph on chat start."""
    mcp_tools = {}

    # Build MCP server configuration for MultiServerMCPClient
    mcp_servers = {}
    agent_mcp_mapping = {}  # Track which agent uses which MCP server

    for agent in AGENTS:
        for mcp_path in agent.mcps:
            server_name = Path(
                mcp_path
            ).stem  # e.g., "server" from "mcps/movies/server.py"
            mcp_servers[server_name] = {
                "command": "uv",
                "args": ["run", "python", mcp_path],
                "transport": "stdio",
            }
            agent_mcp_mapping[server_name] = agent.name

    if mcp_servers:
        try:
            # Create the multi-server client (no context manager needed)
            mcp_client = MultiServerMCPClient(mcp_servers)

            # Get all tools from MCP servers
            all_mcp_tools = await mcp_client.get_tools()

            # Map tools back to their agents
            for tool in all_mcp_tools:
                # Find which agent this tool belongs to based on server name
                for server_name, agent_name in agent_mcp_mapping.items():
                    mcp_tools.setdefault(agent_name, []).append(tool)
                    break  # Each tool only belongs to one agent

            print(
                f"Connected to MCP servers. Tools loaded: {[t.name for t in all_mcp_tools]}"
            )

            # Store client for potential cleanup
            cl.user_session.set("mcp_client", mcp_client)

        except (ConnectionError, TimeoutError, RuntimeError, OSError) as e:
            print(f"Failed to start MCP servers: {e}")
            traceback.print_exc()

    # Build all agents with middleware and MCP tools
    middleware = [ChainlitMiddlewareTracer()]
    supervisor, sub_agents = build_agents(
        AGENTS, mcp_tools=mcp_tools, middleware=middleware
    )
    cl.user_session.set("supervisor", supervisor)
    cl.user_session.set("sub_agents", sub_agents)

    # Set up agent mode picker
    mode_options = [
        cl.ModeOption(
            id="auto",
            name="Auto",
            icon=AUTO_ICON,
            description="Intelligently select the right agent to answer your question.",
            default=True,
        ),
    ]
    for agent in AGENTS:
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

    await send_qa_entrypoint()

    # Build agent cards data for display
    agents_data = {
        "starters": STARTERS,
        "agents": [
            {
                "name": agent.name.replace("_", " ").title(),
                "description": agent.description,
                "icon": agent.icon,
                "tools": [
                    {"name": t.name, "description": t.description}
                    for t in list(agent.tools) + mcp_tools.get(agent.name, [])
                ],
            }
            for agent in AGENTS
        ],
    }

    # Send agent cards as custom element
    agent_cards = cl.CustomElement(name="AgentCards", props=agents_data)
    await cl.Message(content="", elements=[agent_cards]).send()


@cl.action_callback("qa_start")
async def on_qa_start(_action: cl.Action):
    """Start the QA wizard from the explicit action boundary."""
    await run_qa_wizard()


@cl.action_callback("qa_restart")
async def on_qa_restart(action: cl.Action):
    """Restart the QA wizard from the latest session-scoped model."""
    await action.remove()
    await run_qa_wizard()


@cl.action_callback("qa_show_json")
async def on_qa_show_json(action: cl.Action):
    """Resend the last generated QA JSON model."""
    await action.remove()
    model = cl.user_session.get("qa_model")
    if not model:
        await cl.Message(content="No QA JSON model has been generated yet.").send()
        return

    await send_qa_model(model)


@cl.on_message
async def on_message(message: cl.Message):
    """Route messages through agent orchestration."""
    supervisor = cl.user_session.get("supervisor")
    sub_agents = cl.user_session.get("sub_agents")

    if not supervisor or not sub_agents:
        await cl.Message(content="Error: Agents not initialized.").send()
        return

    # Get selected agent mode (defaults to "auto")
    selected_agent = (message.modes or {}).get("agent", "auto")

    # Choose the appropriate agent
    if selected_agent == "auto":
        agent = supervisor
    else:
        agent = sub_agents.get(selected_agent)
        if not agent:
            await cl.Message(content=f"Error: Unknown agent '{selected_agent}'.").send()
            return

    result = await agent.ainvoke(
        {"messages": [{"role": "user", "content": message.content}]}
    )
    ai_messages = [m for m in result["messages"] if m.type == "ai" and m.content]
    response = ai_messages[-1].content if ai_messages else "No response."
    await cl.Message(content=response).send()
