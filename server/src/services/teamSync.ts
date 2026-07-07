import { Team, type ITeam } from '../models/Team.js';
import { User, getDecryptedCredentials } from '../models/User.js';
import { getAdapter } from './fantasy-platform/index.js';
import type { Platform, PlatformCredentials, Sport } from '../types/index.js';
import { getCurrentWeek } from './roster-optimizer/index.js';

export async function syncTeam(teamId: string): Promise<ITeam> {
  const team = await Team.findById(teamId);
  if (!team) throw new Error('Team not found');

  const user = await User.findById(team.userId);
  if (!user) throw new Error('User not found');

  const conn = user.platformConnections.find((c) => c.platform === team.platform);
  if (!conn) throw new Error(`No ${team.platform} connection for user`);

  const credentials = getDecryptedCredentials(conn) as PlatformCredentials;
  const adapter = getAdapter(team.platform, team.sport);
  const account = await adapter.connect(credentials);

  const { roster, settings, raw } = await adapter.getTeamRoster(
    account,
    team.externalLeagueId,
    team.externalTeamId
  );
  const freeAgents = await adapter.getFreeAgents(account, team.externalLeagueId, { limit: 75 });

  const week = getCurrentWeek(team.sport);
  team.roster = roster;
  team.settings = settings;
  team.freeAgentsCache = { players: freeAgents, cachedAt: new Date() };
  team.platformRaw = {
    lastRosterResponse: raw,
    lastSettingsResponse: settings as unknown as Record<string, unknown>,
  };
  team.lastSyncedAt = new Date();

  if (!team.rosterHistory) team.rosterHistory = [];
  const existing = team.rosterHistory.find((h) => h.week === week);
  if (existing) {
    existing.roster = roster;
    existing.syncedAt = new Date();
  } else {
    team.rosterHistory.push({ week, roster, syncedAt: new Date() });
  }

  await team.save();
  return team;
}

export async function importTeamsFromPlatform(
  userId: string,
  platform: Platform,
  credentials: PlatformCredentials,
  sport: Sport = 'nfl',
  selectedLeagues?: Array<{ externalLeagueId: string; externalTeamId: string }>
): Promise<ITeam[]> {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const adapter = getAdapter(platform, sport);
  const account = await adapter.connect(credentials);

  const { encrypt } = await import('../utils/crypto.js');
  const existingIdx = user.platformConnections.findIndex((c) => c.platform === platform);
  const connEntry = {
    platform,
    credentials: encrypt(JSON.stringify(credentials)),
    externalUserId: account.externalUserId,
    connectedAt: new Date(),
  };
  if (existingIdx >= 0) user.platformConnections[existingIdx] = connEntry;
  else user.platformConnections.push(connEntry);

  let leagues = await adapter.getLeagues(account);
  if (selectedLeagues?.length) {
    leagues = leagues.filter((l) =>
      selectedLeagues.some(
        (s) =>
          s.externalLeagueId === l.externalLeagueId &&
          s.externalTeamId === l.externalTeamId
      )
    );
  }

  const imported: ITeam[] = [];
  for (const league of leagues) {
    let team = await Team.findOne({
      userId: user._id,
      platform,
      sport: league.sport,
      externalLeagueId: league.externalLeagueId,
      externalTeamId: league.externalTeamId,
    });

    if (!team) {
      team = new Team({
        userId: user._id,
        platform,
        sport: league.sport,
        externalLeagueId: league.externalLeagueId,
        externalTeamId: league.externalTeamId,
        leagueName: league.leagueName,
        teamName: league.teamName,
        season: league.season,
        settings: {
          scoringFormat: 'ppr',
          rosterSlots: {},
          waiverType: 'rolling',
          numTeams: 12,
        },
        roster: { starters: [], bench: [], ir: [] },
        platformRaw: {},
        agentOptIn: false,
      });
    } else {
      team.leagueName = league.leagueName;
      team.teamName = league.teamName;
      team.season = league.season;
    }

    await team.save();
    if (!user.teamIds.some((id) => id.equals(team!._id))) {
      user.teamIds.push(team._id);
    }
    imported.push(team);
  }

  await user.save();
  for (const t of imported) {
    await syncTeam(String(t._id));
  }
  return imported;
}

export async function discoverLeagues(
  platform: Platform,
  credentials: PlatformCredentials,
  sport: Sport = 'nfl'
) {
  const adapter = getAdapter(platform, sport);
  const account = await adapter.connect(credentials);
  return adapter.getLeagues(account);
}
