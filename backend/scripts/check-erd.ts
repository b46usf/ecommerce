import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getTableConfig } from 'drizzle-orm/mysql-core';
import * as schema from '../src/database/schema.js';

const erd = readFileSync(fileURLToPath(new URL('../../docs/ERD-Struktur-Tabel-Marketplace-v0.1.md', import.meta.url)), 'utf8');
const tables = new Map(Object.values(schema).map(table => {
  const config = getTableConfig(table);
  return [config.name, new Set(config.columns.map(column => column.name))] as const;
}));
const sections = [...erd.matchAll(/^### \d+\. `([^`]+)`\r?\n([\s\S]*?)(?=^### \d+\.|^## 4\.|$(?![\s\S]))/gm)];
const missing: string[] = [];
let columns = 0;
for (const [, name, body] of sections) {
  const actual = tables.get(name!);
  if (!actual) { missing.push(`table: ${name}`); continue; }
  for (const match of body!.matchAll(/^\| `([^`]+)` \|/gm)) {
    for (const column of match[1]!.split(',').map(value => value.trim())) {
      columns++;
      if (!actual.has(column)) missing.push(`${name}.${column}`);
    }
  }
  for (const column of ['id', 'created_at']) if (!actual.has(column)) missing.push(`${name}.${column}`);
}
if (sections.length !== 56) throw new Error(`Expected 56 ERD sections, found ${sections.length}. Check document parser.`);
if (missing.length) {
  console.error(`ERD coverage incomplete:\n${missing.join('\n')}`);
  process.exitCode = 1;
} else console.info(`ERD coverage verified: ${sections.length} tables, ${columns} documented columns; ${tables.size - sections.length} additional infrastructure table(s).`);
