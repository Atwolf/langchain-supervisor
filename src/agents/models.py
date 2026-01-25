from dataclasses import dataclass, field
from typing import Callable


@dataclass
class AgentRecord:
    name: str
    description: str
    route_description: str
    tools: list[Callable] = field(default_factory=list)
    mcps: list[str] = field(default_factory=list)
    icon: str | None = None
