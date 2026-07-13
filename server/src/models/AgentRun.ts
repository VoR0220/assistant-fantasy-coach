import mongoose, { Schema, Document, Types } from 'mongoose';

export type AgentRunStatus = 'running' | 'completed' | 'failed';

export interface IAgentRun extends Document {
  teamId: Types.ObjectId;
  week: number;
  status: AgentRunStatus;
  recommendationIds: Types.ObjectId[];
  errorMessage?: string;
  completedAt?: Date;
  /** Goal-directed agent trace from the latest run */
  agentTrace?: string[];
  primaryGoal?: string;
  llmUsed?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const agentRunSchema = new Schema<IAgentRun>(
  {
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    week: { type: Number, required: true },
    status: {
      type: String,
      enum: ['running', 'completed', 'failed'],
      default: 'running',
    },
    recommendationIds: [{ type: Schema.Types.ObjectId, ref: 'SwapRecommendation' }],
    errorMessage: String,
    completedAt: Date,
    agentTrace: [String],
    primaryGoal: String,
    llmUsed: Boolean,
  },
  { timestamps: true }
);

agentRunSchema.index({ teamId: 1, week: 1 }, { unique: true });

export const AgentRun = mongoose.model<IAgentRun>('AgentRun', agentRunSchema);
