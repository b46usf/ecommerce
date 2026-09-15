import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql, { type PoolOptions } from 'mysql2';
import * as schema from './schema.js';

export type Database = MySql2Database<typeof schema>;
export type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DatabaseExecutor = Database | DatabaseTransaction;

export interface DatabaseConfig {
  databaseUrl: string;
  databaseConnectionLimit?: number;
  databaseTimezone?: 'Z';
}

export function connectionOptions(config: DatabaseConfig): PoolOptions {
  const url = new URL(config.databaseUrl);
  if (url.protocol !== 'mysql:') throw new Error('DATABASE_URL must use mysql://.');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!database || !user || !password || user.toLowerCase() === 'root') {
    throw new Error('Use a dedicated database account with a password and database name.');
  }
  if (url.search || url.hash) throw new Error('DATABASE_URL must not contain query parameters or a fragment.');
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user,
    password,
    database,
    charset: 'utf8mb4_unicode_ci',
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
    multipleStatements: false,
    connectTimeout: 10_000,
    connectionLimit: config.databaseConnectionLimit ?? 10,
    waitForConnections: true,
    queueLimit: 100,
    enableKeepAlive: true,
  };
}

export function createDatabase(config: DatabaseConfig) {
  const callbackPool = mysql.createPool(connectionOptions(config));
  callbackPool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00', default_storage_engine = 'InnoDB'", (error) => {
      if (error) connection.destroy();
    });
  });
  const pool = callbackPool.promise();
  const db = drizzle(pool, { schema, mode: 'default' });
  return {
    db,
    pool,
    async ping() {
      await pool.query('SELECT 1');
    },
    async close() {
      await pool.end();
    },
  };
}
