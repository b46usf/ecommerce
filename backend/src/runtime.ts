import { Redis } from 'ioredis';
import { createDatabase } from './database/index.js';
import type { Config } from './config.js';
import type { Services } from './services.js';

export function createServices(config: Config): Services {
  const database = createDatabase(config);
  const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 3000, commandTimeout: 5000, enableOfflineQueue: false });
  // Request/error handlers report dependency failures without printing URLs or credentials.
  redis.on('error', () => {});
  return { db: database.db, redis, config, checkDatabase: database.ping, close: async () => { redis.disconnect(); await database.close(); } };
}
