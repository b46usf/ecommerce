/* global process */
import { readFileSync, writeFileSync } from 'node:fs';
const path = process.argv[2];
if (!path?.startsWith('src/database/migrations/') || !path.endsWith('.sql')) throw new Error('Pass a generated migration in src/database/migrations.');
const sql = readFileSync(path, 'utf8').replace(/(CREATE TABLE[^;]+\n\));/g, '$1 ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;');
writeFileSync(path, sql);
