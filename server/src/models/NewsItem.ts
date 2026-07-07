import mongoose, { Schema, Document, Types } from 'mongoose';
import type { Sport } from '../types/index.js';

export interface INewsItem extends Document {
  _id: Types.ObjectId;
  headline: string;
  source: string;
  url?: string;
  publishedAt?: Date;
  sport: Sport;
  matchedPlayerIds: string[];
  ingestedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const newsItemSchema = new Schema<INewsItem>(
  {
    headline: { type: String, required: true },
    source: { type: String, required: true },
    url: String,
    publishedAt: Date,
    sport: { type: String, enum: ['nfl', 'nba', 'mlb', 'nhl'], required: true, index: true },
    matchedPlayerIds: { type: [String], default: [] },
    ingestedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

newsItemSchema.index({ headline: 1, source: 1 }, { unique: true });
newsItemSchema.index({ sport: 1, publishedAt: -1 });

export const NewsItem = mongoose.model<INewsItem>('NewsItem', newsItemSchema);
