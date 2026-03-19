import os
from typing import Dict, Optional

import chainlit as cl
from langchain_anthropic import ChatAnthropic
from langchain.agents import create_agent
from langchain_core.tools import StructuredTool

from src.agents import AGENTS
from src.agents.models import AgentRecord
from src.mcp import load_mcp_tools_resilient
from src.middleware import ChainlitMiddlewareTracer
from src.datalayer import get_data_layer
from src.auth import password_auth_callback  # noqa: F401
from src.auth.inject_custom_auth import add_custom_oauth_provider
from src.auth.playground_oauth import PlaygroundOAuthProvider

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


def build_supervisor_prompt(agents: list[AgentRecord]) -> str:
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
    def _make_delegate_fn(agent_name: str, agent_runnable):
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
        fn = _make_delegate_fn(agent.name, sub_agents[agent.name])
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
    # Resilient MCP tool loading — one server failing won't affect others
    mcp_tools, mcp_client = await load_mcp_tools_resilient(AGENTS)

    if mcp_client:
        cl.user_session.set("mcp_client", mcp_client)

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


@cl.on_message
async def on_message(message: cl.Message):
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
