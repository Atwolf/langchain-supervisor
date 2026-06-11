"""Tests for resilient MCP tool loading."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.agents.models import AgentRecord, McpServerConfig
from src.mcp.resilient_loader import load_mcp_tools_resilient, normalize_mcp_config


class TestNormalizeMcpConfig:
    def test_string_path_creates_stdio_config(self):
        name, conn = normalize_mcp_config("mcps/movies/server.py", "movie_agent")
        assert name == "movie_agent__server"
        assert conn == {
            "command": "uv",
            "args": ["run", "python", "mcps/movies/server.py"],
            "transport": "stdio",
        }

    def test_mcp_server_config_stdio(self):
        config = McpServerConfig(
            name="movies", transport="stdio", command="python", args=["server.py"]
        )
        name, conn = normalize_mcp_config(config, "movie_agent")
        assert name == "movie_agent__movies"
        assert conn == {
            "transport": "stdio",
            "command": "python",
            "args": ["server.py"],
        }

    def test_mcp_server_config_http(self):
        config = McpServerConfig(
            name="movies",
            transport="streamable_http",
            url="https://movies.internal/mcp",
            headers={"Authorization": "Bearer token123"},
            timeout=10.0,
        )
        name, conn = normalize_mcp_config(config, "movie_agent")
        assert name == "movie_agent__movies"
        assert conn == {
            "transport": "streamable_http",
            "url": "https://movies.internal/mcp",
            "headers": {"Authorization": "Bearer token123"},
            "timeout": 10.0,
        }

    def test_agent_name_prefix_prevents_collisions(self):
        name1, _ = normalize_mcp_config("mcps/a/server.py", "agent_a")
        name2, _ = normalize_mcp_config("mcps/b/server.py", "agent_b")
        assert name1 == "agent_a__server"
        assert name2 == "agent_b__server"
        assert name1 != name2


class TestLoadMcpToolsResilient:
    @pytest.mark.asyncio
    async def test_no_mcps_returns_empty(self):
        agents = [
            AgentRecord(
                name="math", description="", route_description="", tools=[], mcps=[]
            )
        ]
        tools, client = await load_mcp_tools_resilient(agents)
        assert tools == {}
        assert client is None

    @pytest.mark.asyncio
    @patch("src.mcp.resilient_loader.MultiServerMCPClient")
    async def test_one_server_fails_other_succeeds(self, mock_client_cls):
        mock_tool_a = MagicMock()
        mock_tool_a.name = "tool_a"
        mock_tool_b = MagicMock()
        mock_tool_b.name = "tool_b"

        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client

        async def fake_get_tools(server_name=None):
            if "agent_a" in server_name:
                return [mock_tool_a]
            if "agent_b" in server_name:
                raise ConnectionError("Server B is down")
            return []

        mock_client.get_tools = AsyncMock(side_effect=fake_get_tools)

        agents = [
            AgentRecord(
                name="agent_a",
                description="",
                route_description="",
                mcps=["mcps/a/server.py"],
            ),
            AgentRecord(
                name="agent_b",
                description="",
                route_description="",
                mcps=["mcps/b/server.py"],
            ),
        ]

        tools, client = await load_mcp_tools_resilient(agents)

        assert "agent_a" in tools
        assert len(tools["agent_a"]) == 1
        assert tools["agent_a"][0].name == "tool_a"
        assert "agent_b" not in tools  # Failed server produces no tools

    @pytest.mark.asyncio
    @patch("src.mcp.resilient_loader.MultiServerMCPClient")
    async def test_all_servers_fail_returns_empty(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client
        mock_client.get_tools = AsyncMock(
            side_effect=ConnectionError("All servers down")
        )

        agents = [
            AgentRecord(
                name="agent_a",
                description="",
                route_description="",
                mcps=["mcps/a/server.py"],
            ),
        ]

        tools, client = await load_mcp_tools_resilient(agents)
        assert tools == {}
        assert client is not None  # Client still created even if all servers fail

    @pytest.mark.asyncio
    @patch("src.mcp.resilient_loader.MultiServerMCPClient")
    async def test_agent_with_multiple_mcps_partial_success(self, mock_client_cls):
        mock_tool = MagicMock()
        mock_tool.name = "working_tool"

        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client

        async def fake_get_tools(server_name=None):
            if "good_server" in server_name:
                return [mock_tool]
            raise TimeoutError("Server timed out")

        mock_client.get_tools = AsyncMock(side_effect=fake_get_tools)

        agents = [
            AgentRecord(
                name="multi_mcp_agent",
                description="",
                route_description="",
                mcps=[
                    McpServerConfig(
                        name="good_server",
                        transport="streamable_http",
                        url="https://good.internal/mcp",
                    ),
                    McpServerConfig(
                        name="bad_server",
                        transport="streamable_http",
                        url="https://bad.internal/mcp",
                    ),
                ],
            ),
        ]

        tools, client = await load_mcp_tools_resilient(agents)

        assert "multi_mcp_agent" in tools
        assert len(tools["multi_mcp_agent"]) == 1
        assert tools["multi_mcp_agent"][0].name == "working_tool"
