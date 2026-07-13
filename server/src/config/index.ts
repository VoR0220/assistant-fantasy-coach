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
  /** Public base URL of this API (used for OAuth redirect URIs) */
  apiPublicUrl: process.env.API_PUBLIC_URL ?? 'http://localhost:5000',
  /** Base URL of the web/mobile app to redirect back to after OAuth */
  appWebUrl: process.env.APP_WEB_URL ?? 'http://localhost:8081',
  yahooClientId: process.env.YAHOO_CLIENT_ID ?? '',
  yahooClientSecret: process.env.YAHOO_CLIENT_SECRET ?? '',
};
