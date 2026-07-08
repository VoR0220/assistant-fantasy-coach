"""Long-running cron agent daemon.

Runs forever under APScheduler with two kinds of jobs per sport:

1. Weekly roster-optimization runs — pulls the latest news for the sport and
   POSTs it into the Express agent endpoint so headlines feed directly into
   recommendation reasoning.
2. Hourly news watchers — refresh the news cache and, when breaking injury or
   role-change headlines mention players rostered on opted-in teams, trigger
   an ad-hoc (forced) agent run for just those teams so users hear about it
   before the weekly cycle.

Start with: python -m sports_trends.cron_agent  (or `sports-cron` script)
"""

import asyncio
import logging
import os
import re
import signal
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from dotenv import load_dotenv

from . import data
from .sports import SPORTS

load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), "../../../.env"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
log = logging.getLogger("cron-agent")

# Tuesday 14:00 UTC default — after Monday games, before waivers clear (NFL).
WEEKLY_CRON = os.environ.get("WEEKLY_AGENT_CRON", "0 14 * * 2")
NEWS_INTERVAL_MINUTES = int(os.environ.get("NEWS_WATCH_INTERVAL_MINUTES", "60"))
GAMEDAY_INTERVAL_MINUTES = int(os.environ.get("GAMEDAY_CHECK_INTERVAL_MINUTES", "15"))

# Typical game windows in UTC (conservative; cron still safe if outside)
GAMEDAY_WINDOWS: dict[str, list[tuple[int, int]]] = {
    "nfl": [(17, 5)],   # Sun 17:00–Mon 05:00 UTC
    "nba": [(23, 8)],   # Evening US
    "mlb": [(17, 5)],
    "nhl": [(23, 8)],
}

BREAKING_NEWS = re.compile(
    r"injur|ruled out|out for|placed on (ir|il)|suspend|surgery|torn|fracture"
    r"|benched|traded|waived|released|demoted|starting (job|role)",
    re.IGNORECASE,
)

# Track headlines already acted on so the watcher doesn't re-trigger runs.
# Populated from backend on startup; new headlines come from persist_news response.
_seen_headlines: set[str] = set()


async def weekly_run(sport: str) -> None:
    """Weekly roster-optimization run for one sport, with news-fed reasoning."""
    log.info("Weekly agent run starting for %s", sport)
    try:
        news = await data.get_latest_news(sport, limit=60)
        await data.persist_news(sport, news)
        log.info("Feeding %d %s headlines into reasoning", len(news), sport)
        result = await data.trigger_agent_run(sport=sport, league_news=news)
        results = result.get("results", [])
        ran = sum(1 for r in results if not r.get("skipped") and not r.get("error"))
        errors = [r for r in results if r.get("error")]
        log.info(
            "Weekly %s run complete: %d teams processed, %d skipped, %d errors",
            sport, ran, sum(1 for r in results if r.get("skipped")), len(errors),
        )
        for e in errors:
            log.warning("Team %s failed: %s", e.get("teamId"), e.get("error"))
    except Exception:
        log.exception("Weekly agent run failed for %s", sport)


async def news_watch(sport: str) -> None:
    """Hourly watcher: detect breaking news about rostered players and trigger ad-hoc runs."""
    try:
        news = await data.get_latest_news(sport, limit=100)
        persist_result = await data.persist_news(sport, news)
        new_headlines = set(persist_result.get("newHeadlines", []))
        max_age_hours = (NEWS_INTERVAL_MINUTES * 2) / 60
        breaking = [
            n for n in news
            if BREAKING_NEWS.search(n["headline"])
            and n.get("ageHours", 48) <= max_age_hours
            and (
                n["headline"] in new_headlines
                or n["headline"] not in _seen_headlines
            )
        ]
        if not breaking:
            return

        opted = await data.get_opted_in_teams(sport)
        teams = opted.get("teams", [])
        if not teams:
            for n in breaking:
                _seen_headlines.add(n["headline"])
            return

        affected: dict[str, list[dict]] = {}
        for team in teams:
            ctx = await data.get_team_context(team["_id"])
            roster = (ctx.get("team") or {}).get("roster") or {}
            names = [
                p.get("name", "")
                for group in ("starters", "bench", "ir")
                for p in (roster.get(group) or [])
            ]
            hits = []
            for n in breaking:
                headline = n["headline"].lower()
                for name in names:
                    last = name.split()[-1].lower() if name.split() else ""
                    if name.lower() in headline or (len(last) > 2 and last in headline):
                        hits.append(n)
                        break
            if hits:
                affected[team["_id"]] = hits

        for headline_item in breaking:
            _seen_headlines.add(headline_item["headline"])

        if not affected:
            log.info("%s news watch: %d breaking headlines, no rostered players affected",
                     sport, len(breaking))
            return

        log.info("%s news watch: breaking news affects %d team(s), triggering ad-hoc runs",
                 sport, len(affected))
        for team_id, hits in affected.items():
            try:
                await data.trigger_agent_run(
                    team_id=team_id, league_news=news, force=True
                )
                log.info("Ad-hoc run for team %s (%d matching headlines)", team_id, len(hits))
            except Exception:
                log.exception("Ad-hoc run failed for team %s", team_id)
    except Exception:
        log.exception("News watch failed for %s", sport)


async def gameday_check(sport: str) -> None:
    """Periodic auto-pilot: sync rosters and execute injury-driven lineup fixes."""
    now = datetime.now(timezone.utc)
    windows = GAMEDAY_WINDOWS.get(sport, [(0, 24)])
    in_window = any(
        (start <= end and start <= now.hour < end)
        or (start > end and (now.hour >= start or now.hour < end))
        for start, end in windows
    )
    if not in_window:
        return

    log.info("Gameday auto-pilot check for %s", sport)
    try:
        result = await data.trigger_gameday_check(sport=sport)
        results = result.get("results", [])
        executed = sum(r.get("executed", 0) for r in results)
        failed = sum(r.get("failed", 0) for r in results)
        log.info(
            "Gameday %s complete: %d teams, %d executed, %d failed",
            sport, len(results), executed, failed,
        )
    except Exception:
        log.exception("Gameday check failed for %s", sport)


async def run_daemon() -> None:
    scheduler = AsyncIOScheduler()

    for sport_key in SPORTS:
        scheduler.add_job(
            weekly_run,
            CronTrigger.from_crontab(WEEKLY_CRON),
            args=[sport_key],
            id=f"weekly-{sport_key}",
            name=f"Weekly roster agent ({sport_key})",
            misfire_grace_time=3600,
        )
        scheduler.add_job(
            news_watch,
            "interval",
            minutes=NEWS_INTERVAL_MINUTES,
            args=[sport_key],
            id=f"news-{sport_key}",
            name=f"News watcher ({sport_key})",
            misfire_grace_time=600,
        )
        scheduler.add_job(
            gameday_check,
            "interval",
            minutes=GAMEDAY_INTERVAL_MINUTES,
            args=[sport_key],
            id=f"gameday-{sport_key}",
            name=f"Gameday auto-pilot ({sport_key})",
            misfire_grace_time=300,
        )

    scheduler.start()
    log.info(
        "Cron agent daemon started: weekly cron '%s', news watch every %dm, "
        "gameday every %dm, sports: %s",
        WEEKLY_CRON, NEWS_INTERVAL_MINUTES, GAMEDAY_INTERVAL_MINUTES, ", ".join(SPORTS),
    )

    # Prime the news watchers once at startup so state is warm.
    for sport_key in SPORTS:
        asyncio.get_running_loop().create_task(news_watch(sport_key))

    stop = asyncio.Event()

    def shutdown(*_args: object) -> None:
        log.info("Shutting down cron agent daemon")
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, shutdown)

    await stop.wait()
    scheduler.shutdown(wait=False)


def main() -> None:
    asyncio.run(run_daemon())


if __name__ == "__main__":
    main()
