"""Python MCP server exposing multi-sport fantasy trends, news, and team context tools.

Runs over stdio so both the Cursor IDE (via .cursor/mcp.json) and the cron
agents can consume the same tool surface.
"""

import json
from typing import Any

from mcp.server.fastmcp import FastMCP

from . import data

mcp = FastMCP("sports-trends")


def _dump(obj: Any) -> str:
    return json.dumps(obj, indent=2, default=str)


@mcp.tool()
async def list_supported_sports() -> str:
    """List all sports leagues this server supports (nfl, nba, mlb, nhl)."""
    return _dump(data.supported_sports())


@mcp.tool()
async def get_trending_players(
    sport: str = "nfl",
    trend_type: str = "add",
    lookback_hours: int = 24,
    limit: int = 25,
    position: str | None = None,
) -> str:
    """Get fantasy players trending on add or drop activity for a sport.

    Args:
        sport: League key (nfl, nba, mlb, nhl).
        trend_type: 'add' or 'drop'.
        lookback_hours: Hours to look back (default 24).
        limit: Max results.
        position: Optional position filter (e.g. RB, WR, C, SP).
    """
    result = await data.get_trending_players(
        sport, trend_type, lookback_hours, limit, position
    )
    return _dump(result)


@mcp.tool()
async def get_latest_news(sport: str = "nfl", limit: int = 40) -> str:
    """Get the latest news headlines for a sport from aggregated RSS feeds.

    Args:
        sport: League key (nfl, nba, mlb, nhl).
        limit: Max headlines.
    """
    return _dump(await data.get_latest_news(sport, limit))


@mcp.tool()
async def get_player_news(sport: str, player_names: list[str]) -> str:
    """Get latest news headlines mentioning specific players.

    Args:
        sport: League key.
        player_names: Player full names to match against headlines.
    """
    return _dump(await data.get_player_news(sport, player_names))


@mcp.tool()
async def get_waiver_targets(
    sport: str = "nfl", position: str | None = None, limit: int = 20
) -> str:
    """Ranked waiver-wire / free-agent targets based on trending adds.

    Args:
        sport: League key.
        position: Optional position filter.
        limit: Max targets.
    """
    return _dump(await data.get_waiver_targets(sport, position, limit))


@mcp.tool()
async def get_matchup_outlook(team_id: str) -> str:
    """Weekly outlook for a fantasy team's starters, cross-referenced with latest news.

    Args:
        team_id: MongoDB team ID from the fantasy app backend.
    """
    return _dump(await data.get_matchup_outlook(team_id))


@mcp.tool()
async def get_team_context(team_id: str) -> str:
    """Full team document (roster, settings, free-agent cache) from the backend.

    Args:
        team_id: MongoDB team ID.
    """
    return _dump(await data.get_team_context(team_id))


@mcp.tool()
async def run_roster_agent(
    team_id: str | None = None, sport: str | None = None, force: bool = False
) -> str:
    """Trigger a roster-optimization agent run, feeding in the latest news for reasoning.

    Args:
        team_id: Optional specific team; omit to run all opted-in teams.
        sport: Optional sport filter when running all teams.
        force: Re-run even if this week's run already completed.
    """
    news: list[dict[str, Any]] = []
    if sport:
        news = await data.get_latest_news(sport, limit=60)
    elif team_id:
        ctx = await data.get_team_context(team_id)
        team_sport = (ctx.get("team") or {}).get("sport", "nfl")
        news = await data.get_latest_news(team_sport, limit=60)
    result = await data.trigger_agent_run(team_id, sport, news, force)
    return _dump(result)


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
