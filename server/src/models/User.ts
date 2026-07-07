import mongoose, { Schema, Document, Types } from 'mongoose';
import type { Platform, PlatformCredentials } from '../types/index.js';

export interface IDeviceToken {
  token: string;
  platform: 'ios' | 'android';
  updatedAt: Date;
}

export interface IPlatformConnection {
  platform: Platform;
  credentials: string;
  externalUserId: string;
  connectedAt: Date;
}

export interface IUser extends Document {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  deviceTokens: IDeviceToken[];
  platformConnections: IPlatformConnection[];
  teamIds: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const deviceTokenSchema = new Schema<IDeviceToken>(
  {
    token: { type: String, required: true },
    platform: { type: String, enum: ['ios', 'android'], required: true },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const platformConnectionSchema = new Schema<IPlatformConnection>(
  {
    platform: { type: String, enum: ['sleeper', 'espn', 'yahoo'], required: true },
    credentials: { type: String, required: true },
    externalUserId: { type: String, required: true },
    connectedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    deviceTokens: [deviceTokenSchema],
    platformConnections: [platformConnectionSchema],
    teamIds: [{ type: Schema.Types.ObjectId, ref: 'Team' }],
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>('User', userSchema);

import { decrypt } from '../utils/crypto.js';

export function getDecryptedCredentials(
  conn: IPlatformConnection
): PlatformCredentials {
  return JSON.parse(decrypt(conn.credentials)) as PlatformCredentials;
}
