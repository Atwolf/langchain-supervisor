import os
import traceback
from pathlib import Path

import chainlit as cl
from langchain_anthropic import ChatAnthropic
from langchain.agents import create_agent
from langchain_core.tools import StructuredTool
from langchain_mcp_adapters.client import MultiServerMCPClient

from src.agents import AGENTS
from src.agents.models import AgentRecord
from src.middleware import ChainlitMiddlewareTracer


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


def build_graph(
    agents: list[AgentRecord],
    mcp_tools: dict[str, list] = None,
    middleware: list = None,
):
    """Build the supervisor graph with optional MCP tools and middleware."""
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
            ai_messages = [m for m in result["messages"] if m.type == "ai" and m.content]
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
    return supervisor


@cl.on_chat_start
async def on_chat_start():
    """Initialize MCP servers and build the graph on chat start."""
    mcp_tools = {}

    # Build MCP server configuration for MultiServerMCPClient
    mcp_servers = {}
    agent_mcp_mapping = {}  # Track which agent uses which MCP server

    for agent in AGENTS:
        for mcp_path in agent.mcps:
            server_name = Path(mcp_path).stem  # e.g., "server" from "mcps/movies/server.py"
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

            print(f"Connected to MCP servers. Tools loaded: {[t.name for t in all_mcp_tools]}")

            # Store client for potential cleanup
            cl.user_session.set("mcp_client", mcp_client)

        except Exception as e:
            print(f"Failed to start MCP servers: {e}")
            traceback.print_exc()

    # Build the graph with middleware and MCP tools
    middleware = [ChainlitMiddlewareTracer()]
    graph = build_graph(AGENTS, mcp_tools=mcp_tools, middleware=middleware)
    cl.user_session.set("graph", graph)

    # Build agent cards data for display
    agents_data = {
        "agents": [
            {
                "name": agent.name.replace("_", " ").title(),
                "description": agent.description,
                "tools": [t.name for t in agent.tools] + [t.name for t in mcp_tools.get(agent.name, [])]
            }
            for agent in AGENTS
        ]
    }

    # Send agent cards as custom element
    agent_cards = cl.CustomElement(name="AgentCards", props=agents_data)
    await cl.Message(content="Available agents:", elements=[agent_cards]).send()


@cl.on_message
async def on_message(message: cl.Message):
    graph = cl.user_session.get("graph")
    if not graph:
        await cl.Message(content="Error: Graph not initialized.").send()
        return

    result = await graph.ainvoke(
        {"messages": [{"role": "user", "content": message.content}]}
    )
    ai_messages = [m for m in result["messages"] if m.type == "ai" and m.content]
    response = ai_messages[-1].content if ai_messages else "No response."
    await cl.Message(content=response).send()
