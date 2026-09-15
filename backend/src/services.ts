import type { Redis } from 'ioredis';
import type { Config } from './config.js';
import type { Database } from './database/index.js';

export interface Services {
  db: Database;
  redis: Redis;
  config: Config;
  checkDatabase: () => Promise<void>;
  close: () => Promise<void>;
}
declare module 'fastify' { interface FastifyInstance { services: Services } }
