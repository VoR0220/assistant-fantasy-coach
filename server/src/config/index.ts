import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT ?? '5000', 10),
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/fantasyfootball',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  encryptionKey: process.env.ENCRYPTION_KEY ?? '0123456789abcdef0123456789abcdef',
  internalServiceKey: process.env.INTERNAL_SERVICE_KEY ?? 'dev-internal-key',
  expoAccessToken: process.env.EXPO_ACCESS_TOKEN ?? '',
};
