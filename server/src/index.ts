import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { config } from './config/index.js';
import authRoutes from './routes/auth.js';
import teamRoutes from './routes/teams.js';
import recommendationRoutes from './routes/recommendations.js';
import connectionRoutes from './routes/connections.js';
import internalRoutes from './routes/internal.js';
import debugRoutes from './routes/debug.js';
import lineupRoutes from './routes/lineup.js';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'fantasy-football-api' });
});

app.use('/api/auth', authRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/recommendations', recommendationRoutes);
app.use('/api/connections', connectionRoutes);
app.use('/api/lineup', lineupRoutes);
app.use('/api/internal', internalRoutes);
app.use('/api/debug', debugRoutes);

async function start() {
  await mongoose.connect(config.mongoUri);
  console.log('Connected to MongoDB');
  const server = app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `Port ${config.port} is already in use. Stop the other server with:\n` +
          `  lsof -nP -iTCP:${config.port} -sTCP:LISTEN\n` +
          `  kill <PID>`
      );
    } else {
      console.error('Server error:', err);
    }
    process.exit(1);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export default app;
