/* global process, console */
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
const doc = parse(readFileSync('contracts/openapi.yaml', 'utf8'));
const operations = [];
for (const [path, item] of Object.entries(doc.paths)) for (const [method, op] of Object.entries(item)) {
  if (!op.operationId) continue;
  operations.push({ method, path, id: op.operationId, roles: op['x-roles'], params: op.parameters?.map(p => p.name ?? p.$ref.split('/').at(-1)), body: Object.values(op.requestBody?.content ?? {}).map(c => c.schema.$ref?.split('/').at(-1) ?? c.schema), response: Object.entries(op.responses).filter(([code]) => Number(code) < 300).map(([code, r]) => [code, r.content?.['application/json']?.schema]) });
}
if (process.argv[2] === 'schemas') {
  const names = process.argv.slice(3);
  for (const name of names) console.info(name, JSON.stringify(doc.components.schemas[name]));
} else for (const op of operations) console.info([op.method.toUpperCase(),op.path,op.id,'roles='+op.roles?.join(','),'body='+op.body.join(','),'response='+op.response.map(([code,r])=>`${code}:${r?.$ref?.split('/').at(-1)??(r?'list':'empty')}`).join(',')].join(' | '));
