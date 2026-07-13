import type { ITeam } from '../../models/Team.js';
import type { NewsSnippet, PlayerEntry, PlayerWeekStats } from '../../types/index.js';
import { matchNewsToPlayer } from './index.js';
import { getComplianceDropCandidates } from './compliance.js';
import { scorePlayerAvailability } from './playerAvailability.js';

export interface PlayerCandidateFacts {
  playerId: string;
  name: string;
  position: string;
  nflTeam: string | null;
  playerStatus: string | null;
  active: boolean | null;
  injuryStatus: string | null;
  yearsExp: number | null;
  avgPoints: number | null;
  depthAtPosition: number;
  ruleScore: number;
  tags: string[];
  summary: string;
  newsHeadlines: string[];
}

function depthAtPosition(team: ITeam, player: PlayerEntry): number {
  const bench = team.roster.bench.filter((p) => p.position === player.position).length;
  const starters = team.roster.starters.filter((p) => p.position === player.position).length;
  return bench + starters;
}

function toCandidateFacts(
  player: PlayerEntry,
  team: ITeam,
  perfMap: Record<string, PlayerWeekStats>,
  score: number,
  tags: string[],
  summary: string,
  leagueNews: NewsSnippet[]
): PlayerCandidateFacts {
  const perf = perfMap[player.playerId];
  const news = matchNewsToPlayer(player.name, leagueNews);
  return {
    playerId: player.playerId,
    name: player.name,
    position: player.position,
    nflTeam: player.team ?? null,
    playerStatus: player.playerStatus ?? null,
    active: player.active ?? null,
    injuryStatus: player.injuryStatus ?? null,
    yearsExp: player.yearsExp ?? null,
    avgPoints: perf?.avgPoints ?? null,
    depthAtPosition: depthAtPosition(team, player),
    ruleScore: score,
    tags,
    summary,
    newsHeadlines: news.snippets.map((s) => s.headline).slice(0, 2),
  };
}

export function buildComplianceDropFacts(
  team: ITeam,
  performance: PlayerWeekStats[],
  leagueNews: NewsSnippet[],
  limit = 8
): PlayerCandidateFacts[] {
  const perfMap = Object.fromEntries(performance.map((p) => [p.playerId, p]));
  return getComplianceDropCandidates(team, performance)
    .slice(0, limit)
    .map((c) =>
      toCandidateFacts(c.player, team, perfMap, c.score, c.tags, c.summary, leagueNews)
    );
}

export function buildWaiverDropFacts(
  team: ITeam,
  performance: PlayerWeekStats[],
  leagueNews: NewsSnippet[],
  limit = 6
): PlayerCandidateFacts[] {
  const perfMap = Object.fromEntries(performance.map((p) => [p.playerId, p]));
  const allRoster = [
    ...team.roster.starters,
    ...team.roster.bench,
    ...(team.roster.ir ?? []),
    ...(team.roster.taxi ?? []),
  ];
  const rosterMap = Object.fromEntries(allRoster.map((p) => [p.playerId, p]));

  return performance
    .map((p) => {
      const entry = rosterMap[p.playerId];
      const availability = entry ? scorePlayerAvailability(entry) : { score: 0, tags: [], summary: '' };
      let score = availability.score;
      const tags = [...availability.tags];
      let summary = availability.summary;
      if (score === 0 && p.avgPoints < 3) {
        score = 0.35;
        tags.push('low_points');
        summary = 'Low recent production';
      }
      return { player: entry ?? { playerId: p.playerId, name: p.name, position: p.position }, score, tags, summary };
    })
    .filter((c) => c.score > 0.2 && c.player)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((c) =>
      toCandidateFacts(c.player, team, perfMap, c.score, c.tags, c.summary, leagueNews)
    );
}

export interface WaiverAddFacts {
  playerId: string;
  name: string;
  position: string;
  ruleScore: number;
  tags: string[];
  newsHeadlines: string[];
}

export function buildWaiverAddFacts(
  team: ITeam,
  leagueNews: NewsSnippet[],
  limit = 6
): WaiverAddFacts[] {
  const freeAgents = team.freeAgentsCache?.players ?? [];
  return freeAgents.slice(0, limit).map((fa) => {
    const news = matchNewsToPlayer(fa.name, leagueNews);
    return {
      playerId: fa.playerId,
      name: fa.name,
      position: fa.position,
      ruleScore: 0,
      tags: [],
      newsHeadlines: news.snippets.map((s) => s.headline).slice(0, 2),
    };
  });
}
