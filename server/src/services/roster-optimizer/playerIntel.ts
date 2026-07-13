import type { ITeam } from '../../models/Team.js';
import type { NewsSnippet, PlayerEntry, PlayerWeekStats } from '../../types/index.js';
import { matchNewsToPlayer } from './index.js';
import { scorePlayerAvailability } from './playerAvailability.js';
import type { TeamAssessment } from './planner.js';
import type { SwapRecommendationInput } from '../../types/index.js';
import { getComplianceDropCandidates } from './compliance.js';

export interface PlayerIntelDossier {
  playerId: string;
  name: string;
  position: string;
  role: 'starter' | 'bench' | 'ir' | 'taxi';
  lineupSlot?: string;
  nflTeam: string | null;
  playerStatus: string | null;
  active: boolean | null;
  injuryStatus: string | null;
  yearsExp: number | null;
  avgPoints: number | null;
  pointsLast3Weeks: number[];
  depthAtPosition: number;
  news: NewsSnippet[];
  newsSentiment: number;
  /** One-line availability / roster value summary */
  availabilitySummary: string;
}

const QUESTIONABLE = new Set(['QUESTIONABLE', 'Q', 'GTD', 'DOUBTFUL']);

function rosterRole(
  player: PlayerEntry,
  team: ITeam
): 'starter' | 'bench' | 'ir' | 'taxi' {
  if (team.roster.starters.some((p) => p.playerId === player.playerId)) return 'starter';
  if (team.roster.ir?.some((p) => p.playerId === player.playerId)) return 'ir';
  if (team.roster.taxi?.some((p) => p.playerId === player.playerId)) return 'taxi';
  return 'bench';
}

function depthAtPosition(team: ITeam, player: PlayerEntry): number {
  const all = [...team.roster.starters, ...team.roster.bench];
  return all.filter((p) => p.position === player.position).length;
}

export function buildPlayerDossier(
  player: PlayerEntry,
  team: ITeam,
  perfMap: Record<string, PlayerWeekStats>,
  leagueNews: NewsSnippet[]
): PlayerIntelDossier {
  const perf = perfMap[player.playerId];
  const news = matchNewsToPlayer(player.name, leagueNews);
  const availability = scorePlayerAvailability(player);

  return {
    playerId: player.playerId,
    name: player.name,
    position: player.position,
    role: rosterRole(player, team),
    lineupSlot: player.lineupSlot,
    nflTeam: player.team ?? null,
    playerStatus: player.playerStatus ?? null,
    active: player.active ?? null,
    injuryStatus: player.injuryStatus ?? null,
    yearsExp: player.yearsExp ?? null,
    avgPoints: perf?.avgPoints ?? null,
    pointsLast3Weeks: perf?.pointsLast3Weeks ?? [],
    depthAtPosition: depthAtPosition(team, player),
    news: news.snippets,
    newsSentiment: news.sentiment,
    availabilitySummary: availability.summary || 'Active rostered player',
  };
}

/** Players worth researching before synthesis. */
export function identifyResearchTargets(
  team: ITeam,
  assessment: TeamAssessment,
  recommendations: SwapRecommendationInput[],
  performance: PlayerWeekStats[]
): PlayerEntry[] {
  const targets = new Map<string, PlayerEntry>();
  const add = (p?: PlayerEntry) => {
    if (p?.playerId) targets.set(p.playerId, p);
  };

  const allRoster = [
    ...team.roster.starters,
    ...team.roster.bench,
    ...(team.roster.ir ?? []),
    ...(team.roster.taxi ?? []),
  ];
  const byId = Object.fromEntries(allRoster.map((p) => [p.playerId, p]));

  // Flagged starters (questionable / out)
  for (const p of team.roster.starters) {
    if (p.injuryStatus) add(p);
  }

  // Top compliance drop candidates
  if (assessment.context.overBy > 0) {
    for (const c of getComplianceDropCandidates(team, performance).slice(0, 8)) {
      add(c.player);
    }
  }

  // Everyone referenced in draft recommendations
  for (const rec of recommendations) {
    if (rec.dropPlayer) add(byId[rec.dropPlayer.playerId]);
    if (rec.addPlayer) add(byId[rec.addPlayer.playerId]);
    const la = rec.lineupAction;
    if (la?.sitPlayer) add(byId[la.sitPlayer.playerId]);
    if (la?.startPlayer) add(byId[la.startPlayer.playerId]);
    if (la?.movePlayer) add(byId[la.movePlayer.playerId]);
  }

  // Bench replacements for questionable starters
  for (const starter of team.roster.starters) {
    if (!starter.injuryStatus || !QUESTIONABLE.has(starter.injuryStatus.toUpperCase())) continue;
    for (const b of team.roster.bench) {
      if (b.position === starter.position || ['RB', 'WR', 'TE'].includes(b.position)) {
        add(b);
      }
    }
  }

  return [...targets.values()];
}

export function gatherPlayerIntel(
  team: ITeam,
  performance: PlayerWeekStats[],
  leagueNews: NewsSnippet[],
  players: PlayerEntry[]
): Record<string, PlayerIntelDossier> {
  const perfMap = Object.fromEntries(performance.map((p) => [p.playerId, p]));
  const intel: Record<string, PlayerIntelDossier> = {};
  for (const player of players) {
    intel[player.playerId] = buildPlayerDossier(player, team, perfMap, leagueNews);
  }
  return intel;
}

export function formatIntelForLlm(intel: Record<string, PlayerIntelDossier>): string {
  const dossiers = Object.values(intel).map((d) => ({
    playerId: d.playerId,
    name: d.name,
    position: d.position,
    role: d.role,
    lineupSlot: d.lineupSlot,
    citedFacts: {
      nflTeam: {
        value: d.nflTeam,
        source: 'Sleeper player DB',
        note: d.nflTeam ? `On ${d.nflTeam}` : 'null — not on an NFL roster',
      },
      playerStatus: {
        value: d.playerStatus,
        source: 'Sleeper player DB',
      },
      injuryStatus: {
        value: d.injuryStatus,
        source: 'Sleeper roster sync',
      },
      avgPoints: {
        value: d.avgPoints,
        last3Weeks: d.pointsLast3Weeks,
        source: 'League scoring / recent performance',
      },
      depthAtPosition: {
        value: d.depthAtPosition,
        source: 'Team roster (starters + bench)',
      },
      availability: {
        value: d.availabilitySummary,
        source: 'Rule engine · player availability',
      },
    },
    newsFromMcpRss: d.news.map((n) => ({
      headline: n.headline,
      source: n.source,
      url: n.url ?? null,
      publishedAt: n.publishedAt ?? null,
      citationLabel: `News / MCP · ${n.source}${n.headline ? ` · “${n.headline}”` : ''}`,
    })),
  }));
  return JSON.stringify(dossiers, null, 2);
}

export function intelNewsSnippets(
  intel: Record<string, PlayerIntelDossier>,
  playerIds: string[]
): NewsSnippet[] {
  const seen = new Set<string>();
  const out: NewsSnippet[] = [];
  for (const id of playerIds) {
    for (const n of intel[id]?.news ?? []) {
      const key = `${n.source}:${n.headline}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(n);
    }
  }
  return out.slice(0, 8);
}
