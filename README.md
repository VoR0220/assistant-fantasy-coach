# Multi-Sport Fantasy Roster Optimization Agent

MERN-backend fantasy app with a React Native mobile client, a **Python MCP server** for sports trends/news, and **long-running cron job agents** that feed the latest news into roster-swap reasoning. Expandable to all sports leagues (NFL, NBA, MLB, NHL out of the box).

## Architecture

- **MongoDB** — team-centric JSON documents; a user owns many teams across platforms and sports
- **Express + Node.js** (`server/`) — REST API, Mongoose models, roster optimizer
- **Python backend** (`server/python/`) — MCP server (stdio) + APScheduler cron daemon
- **React Native (Expo)** (`mobile/`) — push-notification-driven mobile app
- **Platform adapters** — Sleeper, ESPN, Yahoo, each sport-aware via a shared `SPORT_CONFIG` registry

## How news feeds reasoning

1. The cron daemon (`sports_trends/cron_agent.py`) runs forever with two job types per sport:
   - **Weekly roster runs** (default `0 14 * * 2`) — aggregates the latest RSS headlines and POSTs them to `/api/internal/agent/run` as `leagueNews`
   - **Hourly news watchers** — detect breaking injury/role-change headlines that mention rostered players and trigger forced ad-hoc runs for affected teams
2. The Express optimizer matches headlines to players by name, adjusts drop/add scores by news sentiment, tags recommendations (`negative_news` / `positive_news`), and embeds headlines in the rationale shown to users.
3. Users get a push notification and approve/dismiss swaps in the mobile app.

## Adding a new sport

Add one entry in each registry — everything else (adapters, optimizer, cron jobs, MCP tools) picks it up:

- `server/src/types/index.ts` → `SPORT_CONFIG`
- `server/python/sports_trends/sports.py` → `SPORTS` (include RSS feeds)

## Quick start

```bash
# MongoDB
docker compose up -d mongodb

# Node deps + Express API
npm install
cp .env.example .env
npm run dev:server

# Python backend (MCP server + cron agents)
npm run py:setup

# Long-running cron agent daemon
npm run agent:cron
# ...or containerized: docker compose --profile agents up -d

# Mobile app
npm run start -w mobile
```

## MCP server

Registered in `.cursor/mcp.json` (stdio, Python). Tools:

| Tool | Purpose |
|------|---------|
| `list_supported_sports` | Registry of supported leagues |
| `get_trending_players` | Add/drop trends per sport (Sleeper market data) |
| `get_latest_news` | Latest headlines per sport from aggregated RSS |
| `get_player_news` | Headlines filtered to specific players |
| `get_waiver_targets` | Ranked free-agent targets |
| `get_matchup_outlook` | Starters cross-referenced with recent news |
| `get_team_context` | Full team document from the backend |
| `run_roster_agent` | Trigger a news-fed optimization run |

Run manually: `npm run mcp:server`

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` / `login` | Auth, JWT |
| POST | `/api/auth/device-token` | Register Expo push token |
| GET | `/api/teams` | List user's teams (all sports) |
| POST | `/api/teams/discover` | Discover leagues (`platform`, `sport`, credentials) |
| POST | `/api/teams/import` | Import teams into MongoDB |
| POST | `/api/teams/:id/sync` | Sync roster + free agents |
| PATCH | `/api/teams/:id/opt-in` | Enable agent per team |
| GET | `/api/recommendations` | Pending swap/lineup suggestions |
| POST | `/api/recommendations/:id/approve` / `dismiss` | Act on a suggestion |
| POST | `/api/internal/agent/run` | Agent trigger; accepts `leagueNews`, `sport`, `force` (x-service-key) |
| GET | `/api/internal/teams/opted-in?sport=` | Opted-in teams for the cron daemon |

## Project structure

```
server/                  Express API + Mongoose models + optimizer
server/python/           Python MCP server + cron agent daemon
mobile/                  Expo React Native app (sport selector, push, swap review)
docker-compose.yml       MongoDB + optional cron-agent container
.cursor/mcp.json         Python MCP server registration
```
