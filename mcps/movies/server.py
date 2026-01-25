"""
MCP Server for Movie Data

This server exposes a list_popular_movies tool that returns
a hardcoded list of popular movies (stub data).
"""

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("Movies")

POPULAR_MOVIES = [
    {"title": "The Shawshank Redemption", "year": 1994, "genre": "Drama"},
    {"title": "The Godfather", "year": 1972, "genre": "Crime"},
    {"title": "The Dark Knight", "year": 2008, "genre": "Action"},
    {"title": "Pulp Fiction", "year": 1994, "genre": "Crime"},
    {"title": "Forrest Gump", "year": 1994, "genre": "Drama"},
    {"title": "Inception", "year": 2010, "genre": "Sci-Fi"},
    {"title": "The Matrix", "year": 1999, "genre": "Sci-Fi"},
    {"title": "Goodfellas", "year": 1990, "genre": "Crime"},
    {"title": "Fight Club", "year": 1999, "genre": "Drama"},
    {"title": "Interstellar", "year": 2014, "genre": "Sci-Fi"},
]


@mcp.tool()
def list_popular_movies(limit: int = 10, genre: str | None = None) -> str:
    """
    Returns a list of popular movies with their title, year, and genre.

    Args:
        limit: Maximum number of movies to return (default: 10)
        genre: Filter by genre (optional)
    """
    movies = POPULAR_MOVIES
    if genre:
        movies = [m for m in movies if m["genre"].lower() == genre.lower()]

    movies = movies[:limit]

    if not movies:
        return "No movies found."

    return "\n".join(
        f"- {m['title']} ({m['year']}) - {m['genre']}" for m in movies
    )


if __name__ == "__main__":
    mcp.run(transport="stdio")
