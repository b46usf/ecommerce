import { loadConfig } from './config.js';
import { createServices } from './runtime.js';
import { buildApp } from './app.js';

const config = loadConfig();
const services = createServices(config);
const app = await buildApp(services);
try {
  await services.redis.connect();
  await services.checkDatabase();
  await app.listen({ host: config.host, port: config.port });
} catch {
  app.log.fatal('API startup failed. Check database and Redis configuration.');
  await app.close();
  process.exitCode = 1;
}
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  if (shuttingDown) return;
  shuttingDown = true;
  void app.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; });
});
