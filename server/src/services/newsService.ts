import { NewsItem } from '../models/NewsItem.js';
import type { NewsSnippet, Sport } from '../types/index.js';

const DEFAULT_WINDOW_HOURS = 72;
const UNDATED_AGE_HOURS = 48;

export interface NewsUpsertInput {
  headline: string;
  source: string;
  url?: string;
  publishedAt?: Date | string;
  sport: Sport;
  matchedPlayerIds?: string[];
}

function parsePublishedAt(value?: Date | string): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function newsAgeHours(publishedAt?: Date): number {
  if (!publishedAt) return UNDATED_AGE_HOURS;
  const ms = Date.now() - publishedAt.getTime();
  return Math.max(0, ms / (1000 * 60 * 60));
}

/** exp(-ageHours / 36) — half weight after ~1 day, near zero after ~5 days */
export function newsRecencyMultiplier(publishedAt?: Date): number {
  const age = newsAgeHours(publishedAt);
  return Math.exp(-age / 36);
}

export async function upsertNewsBatch(
  items: NewsUpsertInput[]
): Promise<{ upserted: number; newHeadlines: string[] }> {
  let upserted = 0;
  const newHeadlines: string[] = [];
  for (const item of items) {
    const publishedAt = parsePublishedAt(item.publishedAt);
    const existing = await NewsItem.findOne({
      headline: item.headline,
      source: item.source,
    })
      .select('_id')
      .lean();
    const result = await NewsItem.updateOne(
      { headline: item.headline, source: item.source },
      {
        $set: {
          url: item.url,
          publishedAt,
          sport: item.sport,
          matchedPlayerIds: item.matchedPlayerIds ?? [],
          ingestedAt: new Date(),
        },
        $setOnInsert: { headline: item.headline, source: item.source },
      },
      { upsert: true }
    );
    if (result.upsertedCount > 0 || result.modifiedCount > 0) upserted += 1;
    if (!existing) newHeadlines.push(item.headline);
  }
  return { upserted, newHeadlines };
}

export async function getNewsForSport(
  sport: Sport,
  options: { sinceHours?: number; limit?: number } = {}
): Promise<Array<NewsSnippet & { ageHours: number }>> {
  const sinceHours = options.sinceHours ?? DEFAULT_WINDOW_HOURS;
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);

  const items = await NewsItem.find({
    sport,
    $or: [{ publishedAt: { $gte: since } }, { publishedAt: { $exists: false } }, { publishedAt: null }],
  })
    .sort({ publishedAt: -1, ingestedAt: -1 })
    .limit(options.limit ?? 100)
    .lean();

  return items
    .map((item) => {
      const publishedAt = item.publishedAt ? new Date(item.publishedAt) : undefined;
      return {
        headline: item.headline,
        source: item.source,
        url: item.url,
        publishedAt,
        ageHours: newsAgeHours(publishedAt),
      };
    })
    .filter((item) => item.ageHours <= sinceHours + UNDATED_AGE_HOURS)
    .sort((a, b) => {
      const aTime = a.publishedAt?.getTime() ?? 0;
      const bTime = b.publishedAt?.getTime() ?? 0;
      return bTime - aTime;
    });
}

export async function getRecentLeagueNews(
  sport: Sport,
  windowHours = DEFAULT_WINDOW_HOURS
): Promise<NewsSnippet[]> {
  const news = await getNewsForSport(sport, { sinceHours: windowHours, limit: 60 });
  return news.map(({ headline, source, url, publishedAt }) => ({
    headline,
    source,
    url,
    publishedAt,
  }));
}

export async function getBreakingHeadlines(
  sport: Sport,
  maxAgeHours: number
): Promise<Array<NewsSnippet & { ageHours: number }>> {
  const news = await getNewsForSport(sport, { sinceHours: maxAgeHours, limit: 100 });
  return news.filter((n) => n.ageHours <= maxAgeHours);
}

export async function headlineAlreadySeen(headline: string, source: string): Promise<boolean> {
  const existing = await NewsItem.findOne({ headline, source }).select('_id').lean();
  return Boolean(existing);
}
