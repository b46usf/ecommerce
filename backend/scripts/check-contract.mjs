/* global console */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootContract = fileURLToPath(new URL('../../Marketplace-API-OpenAPI-v0.1.yaml', import.meta.url));
const backendContract = fileURLToPath(new URL('../contracts/openapi.yaml', import.meta.url));
if (!readFileSync(rootContract).equals(readFileSync(backendContract))) {
  throw new Error('backend/contracts/openapi.yaml berbeda dari Marketplace-API-OpenAPI-v0.1.yaml di root.');
}
console.log('OpenAPI contract copy matches the root source.');
