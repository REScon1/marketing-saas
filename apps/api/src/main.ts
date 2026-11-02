import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { buildServices } from './container.js';
import { createPool, migrate } from './db.js';
import { startWorker } from './worker.js';

const cfg = loadConfig();
const pool = createPool(cfg.databaseUrl);
await migrate(pool, undefined, (m) => console.info(`[migrate] ${m}`));
const { services } = buildServices(pool, cfg);
const app = await buildApp({ services, pool, config: cfg });
const worker = cfg.workerInProcess ? startWorker(services, pool, { log: { info: (m) => app.log.info(m), error: (m, e) => app.log.error({ err: e }, m) } }) : null;

app.log.info(`AI asistent: ${services.ai.label}; publikace: ${services.deps.publisher.label}; worker v procesu: ${worker ? 'ano' : 'ne'}`);
await app.listen({ port: cfg.port, host: cfg.host });

const shutdown = async (sig: string) => {
  app.log.info(`${sig}: ukončuji…`);
  await app.close();
  await worker?.stop();
  await pool.end();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
