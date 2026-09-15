import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type { FastifySchema } from 'fastify';

const contractPath = fileURLToPath(new URL('../../contracts/openapi.yaml', import.meta.url));
export const contract = parse(readFileSync(contractPath, 'utf8'));
export function dereference(value: any): any {
  if (Array.isArray(value)) return value.map(dereference);
  if (!value || typeof value !== 'object') return value;
  if (value.$ref) {
    if (!value.$ref.startsWith('#/')) throw new Error('External schema reference is unsupported');
    const target = value.$ref.slice(2).split('/').reduce((node: any, part: string) => node[part], contract);
    return dereference(target);
  }
  const result: any = {};
  for (const [key, child] of Object.entries(value)) {
    if (['example', 'xml', 'nullable'].includes(key)) continue;
    if (['exclusiveMinimum', 'exclusiveMaximum'].includes(key) && typeof child === 'boolean') continue;
    result[key] = dereference(child);
  }
  // OpenAPI 3.0 uses draft-4 boolean exclusivity; Fastify validates draft-7 numbers.
  if (value.exclusiveMinimum === true) { result.exclusiveMinimum = value.minimum; delete result.minimum; }
  if (value.exclusiveMaximum === true) { result.exclusiveMaximum = value.maximum; delete result.maximum; }
  if (value.nullable && result.type) {
    result.type = [result.type, 'null'];
    if (result.enum) result.enum.push(null);
  }
  return result;
}

/** Use the supplied OpenAPI contract for request validation; unknown body fields are rejected. */
export function routeSchema(operationId: string): FastifySchema {
  for (const path of Object.values(contract.paths) as any[]) {
    for (const operation of Object.values(path) as any[]) {
      if (operation?.operationId !== operationId) continue;
      const schema: any = { operationId, tags: operation.tags, summary: operation.summary };
      const body = operation.requestBody && dereference(operation.requestBody);
      if (body?.content?.['application/json']) schema.body = body.content['application/json'].schema;
      const responses = Object.entries(operation.responses ?? {}).flatMap(([status, raw]) => {
        if (Number(status) < 200 || Number(status) >= 300) return [];
        const response = dereference(raw);
        return response.content?.['application/json']?.schema ? [[status, response.content['application/json'].schema]] : [];
      });
      if (responses.length) schema.response = Object.fromEntries(responses);
      for (const location of ['path', 'query', 'header']) {
        const parameters = [...(path.parameters ?? []), ...(operation.parameters ?? [])].map(dereference).filter(p => p.in === location);
        if (!parameters.length) continue;
        schema[location === 'path' ? 'params' : location === 'query' ? 'querystring' : 'headers'] = {
          type: 'object', additionalProperties: location === 'header',
          properties: Object.fromEntries(parameters.map(p => [location === 'header' ? p.name.toLowerCase() : p.name, p.schema])),
          required: parameters.filter(p => p.required).map(p => location === 'header' ? p.name.toLowerCase() : p.name),
        };
      }
      return schema;
    }
  }
  throw new Error(`Unknown OpenAPI operation: ${operationId}`);
}
