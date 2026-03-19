"""Resilient MCP tool loading with per-server fault isolation.

Wraps MultiServerMCPClient to load tools from each MCP server independently,
so that one server being down does not prevent other servers from loading.
"""

import asyncio
import logging
from pathlib import Path

from langchain_core.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient

from src.agents.models import AgentRecord, McpServerConfig

logger = logging.getLogger(__name__)


def normalize_mcp_config(
    raw: str | McpServerConfig, agent_name: str
) -> tuple[str, dict]:
    """Convert a raw MCP config (string path or McpServerConfig) into a
    (server_name, connection_dict) tuple suitable for MultiServerMCPClient.

    Server names are prefixed with the agent name to avoid collisions when
    multiple agents reference MCP servers with the same stem.
    """
    if isinstance(raw, str):
        stem = Path(raw).stem
        server_name = f"{agent_name}__{stem}"
        return server_name, {
            "command": "uv",
            "args": ["run", "python", raw],
            "transport": "stdio",
        }

    server_name = f"{agent_name}__{raw.name}"
    return server_name, raw.to_connection_dict()


async def load_mcp_tools_resilient(
    agents: list[AgentRecord],
) -> tuple[dict[str, list[BaseTool]], MultiServerMCPClient | None]:
    """Load MCP tools for all agents with per-server fault isolation.

    Each MCP server is loaded independently. If a server fails to connect or
    return tools, a warning is logged and the server is skipped — other servers
    and their agents continue to work.

    Args:
        agents: List of agent records whose ``mcps`` fields define the servers.

    Returns:
        A tuple of (mcp_tools, client) where mcp_tools maps agent names to
        their successfully loaded tools, and client is the MultiServerMCPClient
        instance (or None if no MCP servers were configured).
    """
    all_connections: dict[str, dict] = {}
    server_to_agent: dict[str, str] = {}

    for agent in agents:
        for mcp_raw in agent.mcps:
            server_name, conn_dict = normalize_mcp_config(mcp_raw, agent.name)
            all_connections[server_name] = conn_dict
            server_to_agent[server_name] = agent.name

    if not all_connections:
        return {}, None

    client = MultiServerMCPClient(all_connections)

    async def _safe_load(server_name: str) -> tuple[str, list[BaseTool] | Exception]:
        try:
            tools = await client.get_tools(server_name=server_name)
            return (server_name, tools)
        except Exception as exc:
            return (server_name, exc)

    results = await asyncio.gather(*[_safe_load(name) for name in all_connections])

    mcp_tools: dict[str, list[BaseTool]] = {}
    for server_name, result in results:
        agent_name = server_to_agent[server_name]
        if isinstance(result, Exception):
            logger.warning(
                "MCP server '%s' for agent '%s' failed to load: %s",
                server_name,
                agent_name,
                result,
            )
            continue
        mcp_tools.setdefault(agent_name, []).extend(result)
        logger.info(
            "Loaded %d tools from MCP '%s' for agent '%s': %s",
            len(result),
            server_name,
            agent_name,
            [t.name for t in result],
        )

    return mcp_tools, client
