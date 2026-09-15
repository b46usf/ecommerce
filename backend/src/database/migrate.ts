import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql from 'mysql2/promise';
import { connectionOptions } from './index.js';

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required to run migrations.');
const connection = await mysql.createConnection(connectionOptions({ databaseUrl: url, databaseConnectionLimit: 1 }));
try {
  await connection.query("SET time_zone = '+00:00', default_storage_engine = 'InnoDB'");
  await migrate(drizzle(connection), {
    migrationsFolder: fileURLToPath(new URL('./migrations/', import.meta.url)),
  });
  console.info('Database migrations completed.');
} finally {
  await connection.end();
}
