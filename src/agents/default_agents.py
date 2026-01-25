from langchain_core.tools import tool

from src.agents.models import AgentRecord


@tool
def calculate(expression: str) -> str:
    """Evaluate a mathematical expression and return the result."""
    try:
        result = eval(expression, {"__builtins__": {}}, {})
        return str(result)
    except Exception as e:
        return f"Error evaluating expression: {e}"


@tool
def get_weather(city: str) -> str:
    """Get the current weather for a given city."""
    # Stub implementation
    weather_data = {
        "new york": "72°F, Partly Cloudy",
        "london": "58°F, Rainy",
        "tokyo": "65°F, Clear",
        "paris": "61°F, Overcast",
    }
    return weather_data.get(city.lower(), f"Weather data not available for {city}")


math_agent = AgentRecord(
    name="math_agent",
    description="Evaluate mathematical expressions.",
    route_description="Route to this agent when the user asks to calculate, evaluate, or solve a math problem.",
    tools=[calculate],
    icon="calculator",
)

weather_agent = AgentRecord(
    name="weather_agent",
    description="Look up current weather for cities.",
    route_description="Route to this agent when the user asks about weather, temperature, or climate conditions for a location.",
    tools=[get_weather],
    icon="cloud-sun",
)

movie_agent = AgentRecord(
    name="movie_agent",
    description="Find and list popular movies.",
    route_description="Route to this agent when the user asks about popular movies, movie recommendations, or film lists.",
    tools=[],  # Tools come from MCP server
    mcps=["mcps/movies/server.py"],
    icon="film",
)

AGENTS: list[AgentRecord] = [math_agent, weather_agent, movie_agent]
