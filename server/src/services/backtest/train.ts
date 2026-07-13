import type { BacktestWeekResult } from './replay.js';

/**
 * Convert backtest outcomes into tag weight adjustments.
 * Winning news-driven swaps boost related tags; losing swaps dampen them.
 */
export function trainTagWeightsFromBacktest(
  weeks: BacktestWeekResult[],
  prior: Record<string, number> = {}
): Record<string, number> {
  const weights = { ...prior };
  const bump = (tag: string, delta: number) => {
    const cur = weights[tag] ?? 0.5;
    weights[tag] = Math.min(0.95, Math.max(0.05, cur + delta));
  };

  for (const week of weeks) {
    for (const swap of week.swapsApplied) {
      if (!swap.sitPlayerId || !swap.startPlayerId) continue;
      // Heuristic: week.delta attributed proportionally isn't available per-swap;
      // use success when agent points beat actual overall, or when any swap applied.
      const tags = new Set<string>(['injury_lineup', 'negative_news']);
      for (const line of swap.rationale ?? []) {
        if (typeof line === 'object' && line.sourceKind === 'news') tags.add('news_citation');
        if (typeof line === 'object' && line.sourceKind === 'sleeper') tags.add('sleeper_status');
      }

      const helpful = week.delta > 0.5;
      const harmful = week.delta < -0.5;
      for (const tag of tags) {
        if (helpful) bump(tag, 0.04);
        else if (harmful) bump(tag, -0.04);
      }
    }
  }

  return weights;
}

export function summarizeBacktest(weeks: BacktestWeekResult[]) {
  const totalDelta = weeks.reduce((s, w) => s + w.delta, 0);
  const wins = weeks.filter((w) => w.delta > 0.25).length;
  const losses = weeks.filter((w) => w.delta < -0.25).length;
  const newsWeeks = weeks.filter((w) => w.newsCount > 0).length;
  const swaps = weeks.reduce((s, w) => s + w.swapsApplied.filter((x) => x.sitPlayerId).length, 0);
  return {
    weeks: weeks.length,
    weeksWithNews: newsWeeks,
    swapsApplied: swaps,
    totalDelta: Math.round(totalDelta * 100) / 100,
    avgDelta: weeks.length ? Math.round((totalDelta / weeks.length) * 100) / 100 : 0,
    wins,
    losses,
    ties: weeks.length - wins - losses,
  };
}
