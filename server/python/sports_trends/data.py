"""Data layer: Sleeper trends, RSS news, and Express backend bridge (async, cached)."""

import os
import time
from calendar import timegm
from datetime import datetime, timezone
from typing import Any

import feedparser
import httpx

from .sports import SPORTS, get_sport

SLEEPER_BASE = "https://api.sleeper.app/v1"
API_URL = os.environ.get("API_URL", "http://localhost:5000")
SERVICE_KEY = os.environ.get("INTERNAL_SERVICE_KEY", "dev-internal-key")

_PLAYERS_TTL = 6 * 60 * 60
_NEWS_TTL = 15 * 60
_AGENT_NEWS_WINDOW_HOURS = 72

_players_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_news_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}


def _parse_published_at(entry: dict[str, Any]) -> str | None:
    """Normalize feedparser entry to ISO-8601 UTC string."""
    parsed = entry.get("published_parsed") or entry.get("updated_parsed")
    if parsed:
        try:
            return datetime.fromtimestamp(timegm(parsed), tz=timezone.utc).isoformat()
        except (TypeError, ValueError, OverflowError):
            pass
    raw = entry.get("published") or entry.get("updated")
    if raw:
        try:
            dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).isoformat()
        except ValueError:
            pass
    return None


def _news_age_hours(published_at: str | None) -> float:
    if not published_at:
        return 48.0
    try:
        dt = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return max(0.0, (datetime.now(timezone.utc) - dt).total_seconds() / 3600)
    except ValueError:
        return 48.0


def _within_hours(published_at: str | None, max_hours: float) -> bool:
    return _news_age_hours(published_at) <= max_hours


async def _sleeper_get(path: str) -> Any:
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.get(f"{SLEEPER_BASE}{path}")
        res.raise_for_status()
        return res.json()


async def get_players_map(sleeper_key: str) -> dict[str, Any]:
    cached = _players_cache.get(sleeper_key)
    if cached and time.time() - cached[0] < _PLAYERS_TTL:
        return cached[1]
    players = await _sleeper_get(f"/players/{sleeper_key}")
    _players_cache[sleeper_key] = (time.time(), players)
    return players


def _enrich(player_id: str, players: dict[str, Any]) -> dict[str, Any]:
    p = players.get(player_id) or {}
    name = p.get("full_name") or " ".join(
        x for x in [p.get("first_name"), p.get("last_name")] if x
    ) or f"Player {player_id}"
    return {
        "playerId": player_id,
        "name": name,
        "position": p.get("position") or (p.get("fantasy_positions") or ["UNKNOWN"])[0],
        "team": p.get("team"),
        "injuryStatus": p.get("injury_status"),
    }


async def get_trending_players(
    sport: str,
    trend_type: str = "add",
    lookback_hours: int = 24,
    limit: int = 25,
    position: str | None = None,
) -> list[dict[str, Any]]:
    sport_def = get_sport(sport)
    if not sport_def.sleeper_key:
        return []
    raw = await _sleeper_get(
        f"/players/{sport_def.sleeper_key}/trending/{trend_type}"
        f"?lookback_hours={lookback_hours}&limit={limit}"
    )
    players = await get_players_map(sport_def.sleeper_key)
    result = []
    for t in raw:
        entry = _enrich(t["player_id"], players)
        entry["trendCount"] = t["count"]
        entry["trendType"] = trend_type
        if position and entry["position"] != position:
            continue
        result.append(entry)
    return result


def _fetch_feed(url: str) -> list[dict[str, Any]]:
    parsed = feedparser.parse(url)
    source = parsed.feed.get("title", url) if parsed.feed else url
    items = []
    for entry in parsed.entries[:25]:
        published_at = _parse_published_at(entry)
        items.append(
            {
                "headline": entry.get("title", ""),
                "source": source,
                "url": entry.get("link"),
                "publishedAt": published_at,
            }
        )
    return items


async def get_latest_news(sport: str, limit: int = 40) -> list[dict[str, Any]]:
    """Latest news headlines for a sport, aggregated from RSS feeds with a short cache."""
    sport_def = get_sport(sport)
    cached = _news_cache.get(sport)
    if cached and time.time() - cached[0] < _NEWS_TTL:
        items = cached[1]
    else:
        items: list[dict[str, Any]] = []
        for feed_url in sport_def.news_feeds:
            try:
                items.extend(_fetch_feed(feed_url))
            except Exception:
                continue
        _news_cache[sport] = (time.time(), items)

    sorted_items = sorted(
        items,
        key=lambda n: n.get("publishedAt") or "",
        reverse=True,
    )
    windowed = [
        {**n, "ageHours": _news_age_hours(n.get("publishedAt"))}
        for n in sorted_items
        if _within_hours(n.get("publishedAt"), _AGENT_NEWS_WINDOW_HOURS)
    ]
    return windowed[:limit]


async def persist_news(sport: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    """Upsert fetched headlines into the backend news store."""
    if not items:
        return {"upserted": 0, "newHeadlines": []}
    payload = {
        "items": [
            {
                "headline": n["headline"],
                "source": n["source"],
                "url": n.get("url"),
                "publishedAt": n.get("publishedAt"),
                "sport": sport,
            }
            for n in items
            if n.get("headline")
        ]
    }
    if not payload["items"]:
        return {"upserted": 0, "newHeadlines": []}
    return await _backend_post("/api/internal/news", payload)


async def get_news_history(sport: str, since_hours: int = 72, limit: int = 100) -> list[dict[str, Any]]:
    """Read persisted news from the backend (newest first, with ageHours)."""
    data = await _backend_get(
        f"/api/internal/news?sport={sport}&sinceHours={since_hours}&limit={limit}"
    )
    return data.get("news", [])


async def get_player_news(
    sport: str,
    player_names: list[str],
) -> list[dict[str, Any]]:
    """Filter the latest sport news down to headlines mentioning given players."""
    news = await get_latest_news(sport, limit=100)
    matches = []
    for name in player_names:
        last = name.split()[-1].lower() if name.split() else ""
        for item in news:
            headline = item["headline"].lower()
            if name.lower() in headline or (len(last) > 2 and last in headline):
                matches.append({**item, "playerName": name})
    return matches


async def get_waiver_targets(
    sport: str,
    position: str | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    trending = await get_trending_players(sport, "add", 72, 100, position)
    targets = []
    for i, p in enumerate(trending[:limit]):
        targets.append(
            {
                "rank": i + 1,
                **p,
                "note": f"Trending add with {p['trendCount']} adds in last 72h",
            }
        )
    return targets


async def _backend_get(path: str) -> Any:
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.get(
            f"{API_URL}{path}", headers={"x-service-key": SERVICE_KEY}
        )
        res.raise_for_status()
        return res.json()


async def _backend_post(path: str, payload: dict[str, Any]) -> Any:
    async with httpx.AsyncClient(timeout=120) as client:
        res = await client.post(
            f"{API_URL}{path}",
            json=payload,
            headers={"x-service-key": SERVICE_KEY},
        )
        res.raise_for_status()
        return res.json()


async def get_team_context(team_id: str) -> Any:
    return await _backend_get(f"/api/internal/teams/{team_id}")


async def get_opted_in_teams(sport: str | None = None) -> Any:
    path = "/api/internal/teams/opted-in"
    if sport:
        path += f"?sport={sport}"
    return await _backend_get(path)


async def trigger_agent_run(
    team_id: str | None = None,
    sport: str | None = None,
    league_news: list[dict[str, Any]] | None = None,
    force: bool = False,
) -> Any:
    payload: dict[str, Any] = {"force": force}
    if team_id:
        payload["teamId"] = team_id
    if sport:
        payload["sport"] = sport
    if league_news:
        payload["leagueNews"] = [
            {
                "headline": n["headline"],
                "source": n["source"],
                "url": n.get("url"),
                "publishedAt": n.get("publishedAt"),
            }
            for n in league_news
        ]
    return await _backend_post("/api/internal/agent/run", payload)


async def trigger_gameday_check(
    team_id: str | None = None, sport: str | None = None
) -> Any:
    payload: dict[str, Any] = {}
    if team_id:
        payload["teamId"] = team_id
    if sport:
        payload["sport"] = sport
    return await _backend_post("/api/internal/lineup/gameday-check", payload)


async def get_decision_history(team_id: str) -> Any:
    return await _backend_get(f"/api/internal/teams/{team_id}/decision-history")


async def get_matchup_outlook(team_id: str) -> list[dict[str, Any]]:
    data = await get_team_context(team_id)
    team = data.get("team", {})
    sport = team.get("sport", "nfl")
    starters = (team.get("roster") or {}).get("starters") or []
    names = [p.get("name", "") for p in starters]
    news = await get_player_news(sport, names)
    news_by_player = {}
    for n in news:
        news_by_player.setdefault(n["playerName"], []).append(n["headline"])

    outlook = []
    for p in starters:
        name = p.get("name", "")
        outlook.append(
            {
                "playerName": name,
                "position": p.get("position"),
                "proTeam": p.get("team"),
                "injuryStatus": p.get("injuryStatus"),
                "recentHeadlines": news_by_player.get(name, [])[:3],
                "outlook": (
                    f"{name} has recent news coverage — review before lineup lock"
                    if name in news_by_player
                    else f"No notable recent news for {name}"
                ),
            }
        )
    return outlook


def supported_sports() -> list[dict[str, Any]]:
    return [
        {
            "sport": s.key,
            "label": s.label,
            "trendsAvailable": s.sleeper_key is not None,
            "newsFeeds": len(s.news_feeds),
        }
        for s in SPORTS.values()
    ]
