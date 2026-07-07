"""Sport registry. Add a new sport here and every tool, feed, and cron job picks it up."""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class SportDef:
    key: str                       # canonical key used across the app ('nfl', 'nba', ...)
    label: str
    sleeper_key: str | None        # Sleeper API sport segment, None if unsupported
    espn_game_code: str | None     # ESPN fantasy game code
    yahoo_game_key: str | None
    news_feeds: list[str] = field(default_factory=list)  # RSS feeds for latest news


SPORTS: dict[str, SportDef] = {
    "nfl": SportDef(
        key="nfl",
        label="Football",
        sleeper_key="nfl",
        espn_game_code="ffl",
        yahoo_game_key="nfl",
        news_feeds=[
            "https://www.espn.com/espn/rss/nfl/news",
            "https://sports.yahoo.com/nfl/rss/",
            "https://www.cbssports.com/rss/headlines/nfl/",
        ],
    ),
    "nba": SportDef(
        key="nba",
        label="Basketball",
        sleeper_key="nba",
        espn_game_code="fba",
        yahoo_game_key="nba",
        news_feeds=[
            "https://www.espn.com/espn/rss/nba/news",
            "https://sports.yahoo.com/nba/rss/",
        ],
    ),
    "mlb": SportDef(
        key="mlb",
        label="Baseball",
        sleeper_key=None,
        espn_game_code="flb",
        yahoo_game_key="mlb",
        news_feeds=[
            "https://www.espn.com/espn/rss/mlb/news",
            "https://sports.yahoo.com/mlb/rss/",
        ],
    ),
    "nhl": SportDef(
        key="nhl",
        label="Hockey",
        sleeper_key=None,
        espn_game_code="fhl",
        yahoo_game_key="nhl",
        news_feeds=[
            "https://www.espn.com/espn/rss/nhl/news",
            "https://sports.yahoo.com/nhl/rss/",
        ],
    ),
}


def get_sport(key: str) -> SportDef:
    sport = SPORTS.get(key.lower())
    if not sport:
        raise ValueError(f"Unsupported sport '{key}'. Supported: {', '.join(SPORTS)}")
    return sport
