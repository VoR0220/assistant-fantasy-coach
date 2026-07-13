import mongoose, { Schema, Document, Types } from 'mongoose';
import type { SwapPlayerRef, NewsSnippet, RecommendationKind, LineupActionInput } from '../types/index.js';

export type RecommendationStatus = 'pending' | 'approved' | 'dismissed' | 'executed';

export interface ISwapRecommendation extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  teamId: Types.ObjectId;
  week: number;
  kind: RecommendationKind;
  dropPlayer?: SwapPlayerRef;
  /** Equal drop choices for radio selection (includes dropPlayer when set) */
  dropAlternatives?: SwapPlayerRef[];
  addPlayer?: SwapPlayerRef;
  lineupAction?: LineupActionInput;
  confidence: number;
  rationale: string[];
  newsSnippets: NewsSnippet[];
  status: RecommendationStatus;
  decidedAt?: Date;
  executionResult?: { success: boolean; message: string; deepLink?: string };
  createdAt: Date;
  updatedAt: Date;
}

const swapPlayerSchema = new Schema(
  {
    playerId: String,
    name: String,
    position: String,
    reasonTags: [String],
  },
  { _id: false }
);

const newsSnippetSchema = new Schema(
  {
    headline: String,
    source: String,
    url: String,
    publishedAt: Date,
  },
  { _id: false }
);

const lineupActionSchema = new Schema(
  {
    sitPlayer: swapPlayerSchema,
    startPlayer: swapPlayerSchema,
    movePlayer: swapPlayerSchema,
    fromSlot: String,
    toSlot: String,
    freesSlot: String,
  },
  { _id: false }
);

const swapRecommendationSchema = new Schema<ISwapRecommendation>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
    week: { type: Number, required: true },
    kind: {
      type: String,
      enum: ['add_drop', 'lineup_sit_start', 'lineup_flex_move', 'roster_drop', 'move_to_taxi'],
      default: 'add_drop',
    },
    dropPlayer: swapPlayerSchema,
    dropAlternatives: [swapPlayerSchema],
    addPlayer: swapPlayerSchema,
    lineupAction: lineupActionSchema,
    confidence: { type: Number, required: true, min: 0, max: 1 },
    rationale: [String],
    newsSnippets: [newsSnippetSchema],
    status: {
      type: String,
      enum: ['pending', 'approved', 'dismissed', 'executed'],
      default: 'pending',
    },
    decidedAt: Date,
    executionResult: {
      success: Boolean,
      message: String,
      deepLink: String,
    },
  },
  { timestamps: true }
);

swapRecommendationSchema.index({ teamId: 1, week: 1, status: 1 });

export const SwapRecommendation = mongoose.model<ISwapRecommendation>(
  'SwapRecommendation',
  swapRecommendationSchema
);
