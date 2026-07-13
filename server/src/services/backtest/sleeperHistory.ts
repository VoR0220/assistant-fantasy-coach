/**
 * Sleeper historical matchup / score helpers for backtests.
 * Public REST only — no auth required for league matchups.
 */

const SLEEPER_BASE = 'https://api.sleeper.app/v1';

async function sleeperFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${SLEEPER_BASE}${path}`);
  if (!res.ok) throw new Error(`Sleeper API error: ${res.status} ${path}`);
  return res.json() as Promise<T>;
}

export interface SleeperMatchupRow {
  roster_id: number;
  matchup_id: number | null;
  points: number | null;
  starters: string[] | null;
  players: string[] | null;
  starters_points?: number[] | null;
  players_points?: Record<string, number> | null;
}

export async function fetchLeagueMatchups(
  leagueId: string,
  week: number
): Promise<SleeperMatchupRow[]> {
  return sleeperFetch<SleeperMatchupRow[]>(`/league/${leagueId}/matchups/${week}`);
}

export async function fetchLeagueRosters(
  leagueId: string
): Promise<Array<{ roster_id: number; owner_id: string; players?: string[] }>> {
  return sleeperFetch(`/league/${leagueId}/rosters`);
}

/**
 * Points map for every player who appeared in any matchup that week.
 * Prefer players_points; fall back to pairing starters with starters_points.
 */
export function buildWeekPointsMap(matchups: SleeperMatchupRow[]): Record<string, number> {
  const pts: Record<string, number> = {};
  for (const m of matchups) {
    if (m.players_points) {
      for (const [id, p] of Object.entries(m.players_points)) {
        pts[id] = p ?? 0;
      }
    }
    if (m.starters && m.starters_points) {
      m.starters.forEach((id, i) => {
        if (id && pts[id] === undefined) {
          pts[id] = m.starters_points?.[i] ?? 0;
        }
      });
    }
  }
  return pts;
}

export function findRosterMatchup(
  matchups: SleeperMatchupRow[],
  rosterId: number
): SleeperMatchupRow | undefined {
  return matchups.find((m) => m.roster_id === rosterId);
}

export async function sumPriorWeekAverages(
  leagueId: string,
  rosterId: number,
  week: number,
  lookback = 3
): Promise<Record<string, { avg: number; weeks: number[] }>> {
  const start = Math.max(1, week - lookback);
  const byPlayer: Record<string, number[]> = {};

  for (let w = start; w < week; w++) {
    const matchups = await fetchLeagueMatchups(leagueId, w);
    const row = findRosterMatchup(matchups, rosterId);
    if (!row) continue;
    const pts = buildWeekPointsMap([row]);
    // Also include any player on this roster that week from players list
    const ids = new Set([...(row.players ?? []), ...(row.starters ?? [])]);
    for (const id of ids) {
      if (!id) continue;
      if (!byPlayer[id]) byPlayer[id] = [];
      byPlayer[id].push(pts[id] ?? 0);
    }
  }

  const out: Record<string, { avg: number; weeks: number[] }> = {};
  for (const [id, weeks] of Object.entries(byPlayer)) {
    const avg = weeks.reduce((a, b) => a + b, 0) / Math.max(weeks.length, 1);
    out[id] = { avg, weeks };
  }
  return out;
}
