import mongoose, { Schema, Document, Types } from 'mongoose';
import type { Sport } from '../types/index.js';

export interface IBacktestRun extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  teamId: Types.ObjectId;
  season: number;
  sport: Sport;
  startWeek: number;
  endWeek: number;
  lookbackHours: number;
  status: 'running' | 'completed' | 'failed';
  summary?: {
    weeks: number;
    weeksWithNews: number;
    swapsApplied: number;
    totalDelta: number;
    avgDelta: number;
    wins: number;
    losses: number;
    ties: number;
  };
  trainedTagWeights?: Record<string, number>;
  weeks: Array<{
    week: number;
    asOf: string;
    newsCount: number;
    actualPoints: number;
    agentPoints: number;
    delta: number;
    gainedPoints: number;
    lostPoints: number;
    swapsApplied: unknown[];
    actualStarterIds: string[];
    agentStarterIds: string[];
  }>;
  errorMessage?: string;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const backtestRunSchema = new Schema<IBacktestRun>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
    season: { type: Number, required: true },
    sport: { type: String, enum: ['nfl', 'nba', 'mlb', 'nhl'], required: true },
    startWeek: { type: Number, required: true },
    endWeek: { type: Number, required: true },
    lookbackHours: { type: Number, default: 168 },
    status: {
      type: String,
      enum: ['running', 'completed', 'failed'],
      default: 'running',
    },
    summary: {
      weeks: Number,
      weeksWithNews: Number,
      swapsApplied: Number,
      totalDelta: Number,
      avgDelta: Number,
      wins: Number,
      losses: Number,
      ties: Number,
    },
    trainedTagWeights: Schema.Types.Mixed,
    weeks: { type: Schema.Types.Mixed, default: [] },
    errorMessage: String,
    completedAt: Date,
  },
  { timestamps: true }
);

backtestRunSchema.index({ teamId: 1, season: 1, createdAt: -1 });

export const BacktestRun = mongoose.model<IBacktestRun>('BacktestRun', backtestRunSchema);
