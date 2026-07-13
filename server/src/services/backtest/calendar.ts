import { SPORT_CONFIG, type Sport } from '../../types/index.js';

/**
 * Approximate decision cutoff for week W: start of that scoring week (UTC),
 * before games — so only news published ≤ asOf is fair game (no look-ahead).
 */
export function weekDecisionAsOf(season: number, week: number, sport: Sport = 'nfl'): Date {
  const cfg = SPORT_CONFIG[sport];
  const start = new Date(
    Date.UTC(season, cfg.seasonStart.month, cfg.seasonStart.day, 16, 0, 0)
  );
  return new Date(start.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000);
}

/** Last completed season relative to "today" (Jul 2026 → 2025 NFL). */
export function lastCompletedSeason(sport: Sport = 'nfl', now = new Date()): number {
  const cfg = SPORT_CONFIG[sport];
  const thisYearStart = new Date(now.getFullYear(), cfg.seasonStart.month, cfg.seasonStart.day);
  if (now < thisYearStart) {
    return now.getFullYear() - 1;
  }
  // Mid-season: prior full season is previous calendar year; offseason after Week 18:
  // if we're past season start but before ~Feb, season year is current; last completed is prior.
  const weeksSince = Math.floor(
    (now.getTime() - thisYearStart.getTime()) / (7 * 24 * 60 * 60 * 1000)
  );
  if (weeksSince > cfg.totalWeeks) {
    return now.getFullYear(); // season just finished still labeled with this year for NFL
  }
  return now.getFullYear() - 1;
}

export function defaultBacktestWeeks(sport: Sport = 'nfl'): { startWeek: number; endWeek: number } {
  const total = SPORT_CONFIG[sport].totalWeeks;
  // Regular season for NFL is weeks 1–18; evaluate weeks 2–17 (need prior-week perf).
  return { startWeek: 2, endWeek: Math.min(17, total) };
}
