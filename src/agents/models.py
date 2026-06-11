from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass
class McpServerConfig:
    """Configuration for a single MCP server connection.

    Supports stdio, sse, streamable_http, and websocket transports.
    """

    name: str
    transport: str = "stdio"
    # stdio fields
    command: str | None = None
    args: list[str] = field(default_factory=list)
    env: dict[str, str] | None = None
    # http/sse/websocket fields
    url: str | None = None
    headers: dict[str, Any] | None = None
    timeout: float | None = None

    def to_connection_dict(self) -> dict[str, Any]:
        """Convert to the dict format MultiServerMCPClient expects."""
        if self.transport == "stdio":
            conn: dict[str, Any] = {
                "transport": "stdio",
                "command": self.command,
                "args": self.args,
            }
            if self.env is not None:
                conn["env"] = self.env
            return conn

        conn = {"transport": self.transport, "url": self.url}
        if self.headers is not None:
            conn["headers"] = self.headers
        if self.timeout is not None:
            conn["timeout"] = self.timeout
        return conn


@dataclass
class AgentRecord:
    name: str
    description: str
    route_description: str
    tools: list[Callable] = field(default_factory=list)
    mcps: list[str | McpServerConfig] = field(default_factory=list)
    icon: str | None = None
