import type { Platform, Sport } from '../../types/index.js';
import { SPORT_CONFIG } from '../../types/index.js';
import { SleeperAdapter } from './sleeper.js';
import { ESPNAdapter } from './espn.js';
import { YahooAdapter } from './yahoo.js';
import type { FantasyPlatformAdapter } from './types.js';

export type { FantasyPlatformAdapter } from './types.js';
export { SleeperAdapter, ESPNAdapter, YahooAdapter };

export function getAdapter(platform: Platform, sport: Sport = 'nfl'): FantasyPlatformAdapter {
  const cfg = SPORT_CONFIG[sport];
  switch (platform) {
    case 'sleeper':
      if (!cfg.sleeperKey) throw new Error(`Sleeper does not support ${sport}`);
      return new SleeperAdapter(sport);
    case 'espn':
      if (!cfg.espnGameCode) throw new Error(`ESPN fantasy does not support ${sport}`);
      return new ESPNAdapter(sport);
    case 'yahoo':
      if (!cfg.yahooGameKey) throw new Error(`Yahoo fantasy does not support ${sport}`);
      return new YahooAdapter(sport);
  }
}
