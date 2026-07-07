import mongoose, { Schema, Document, Types } from 'mongoose';
import type { Platform, Sport, LeagueSettings, NormalizedRoster, PlayerEntry } from '../types/index.js';

export interface IFreeAgentsCache {
  players: PlayerEntry[];
  cachedAt: Date;
}

export interface IPlatformRaw {
  lastRosterResponse?: Record<string, unknown>;
  lastSettingsResponse?: Record<string, unknown>;
}

export interface ITeam extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  platform: Platform;
  sport: Sport;
  externalLeagueId: string;
  externalTeamId: string;
  leagueName: string;
  teamName: string;
  season: number;
  settings: LeagueSettings;
  roster: NormalizedRoster;
  freeAgentsCache?: IFreeAgentsCache;
  platformRaw: IPlatformRaw;
  agentOptIn: boolean;
  lastSyncedAt?: Date;
  rosterHistory?: Array<{ week: number; roster: NormalizedRoster; syncedAt: Date }>;
  createdAt: Date;
  updatedAt: Date;
}

const playerEntrySchema = new Schema(
  {
    playerId: String,
    name: String,
    position: String,
    team: String,
    injuryStatus: String,
    lineupSlot: String,
    fantasyPoints: {
      week: Number,
      season: Number,
    },
  },
  { _id: false }
);

const teamSchema = new Schema<ITeam>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    platform: { type: String, enum: ['sleeper', 'espn', 'yahoo'], required: true },
    sport: { type: String, enum: ['nfl', 'nba', 'mlb', 'nhl'], required: true, default: 'nfl' },
    externalLeagueId: { type: String, required: true },
    externalTeamId: { type: String, required: true },
    leagueName: { type: String, required: true },
    teamName: { type: String, required: true },
    season: { type: Number, required: true },
    settings: {
      scoringFormat: {
        type: String,
        enum: ['ppr', 'half_ppr', 'standard', 'points', 'categories'],
        default: 'ppr',
      },
      rosterSlots: { type: Schema.Types.Mixed, default: {} },
      waiverType: { type: String, enum: ['faab', 'rolling', 'none'], default: 'rolling' },
      numTeams: { type: Number, default: 12 },
    },
    roster: {
      starters: [playerEntrySchema],
      bench: [playerEntrySchema],
      ir: [playerEntrySchema],
    },
    freeAgentsCache: {
      players: [playerEntrySchema],
      cachedAt: Date,
    },
    platformRaw: {
      lastRosterResponse: Schema.Types.Mixed,
      lastSettingsResponse: Schema.Types.Mixed,
    },
    agentOptIn: { type: Boolean, default: false },
    lastSyncedAt: Date,
    rosterHistory: [
      {
        week: Number,
        roster: {
          starters: [playerEntrySchema],
          bench: [playerEntrySchema],
          ir: [playerEntrySchema],
        },
        syncedAt: Date,
      },
    ],
  },
  { timestamps: true }
);

teamSchema.index(
  { userId: 1, platform: 1, sport: 1, externalLeagueId: 1, externalTeamId: 1 },
  { unique: true }
);
teamSchema.index({ agentOptIn: 1, sport: 1, lastSyncedAt: 1 });

export const Team = mongoose.model<ITeam>('Team', teamSchema);
