import type { Services } from '@ms/core';
import type pg from 'pg';
import { pathToFileURL } from 'node:url';
import { AuthRepo } from './auth.js';
import { loadConfig } from './config.js';
import { buildServices } from './container.js';
import { createPool } from './db.js';

export interface WorkerOptions {
  publishEveryMs?: number;
  metricsEveryMs?: number;
  log?: Pick<Console, 'info' | 'error'>;
}

/**
 * Smyčka workeru: každých 30 s zpracuje splatné publikace (outbox), každou hodinu stáhne
 * metriky pro všechny agentury. Vrací funkci stop(), která počká na doběhnutí rozpracované iterace.
 */
export function startWorker(services: Services, pool: pg.Pool, opts: WorkerOptions = {}) {
  const publishEvery = opts.publishEveryMs ?? 30_000;
  const metricsEvery = opts.metricsEveryMs ?? 3600_000;
  const log = opts.log ?? console;
  const auth = new AuthRepo(pool);
  let stopping = false;
  let lastMetrics = 0;
  let wake: (() => void) | null = null;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(t);
        resolve();
      };
    });

  async function tick() {
    try {
      const r = await services.publishing.runDue();
      if (r.processed.length || r.reconciled.length) {
        log.info(`[worker] publikace: zpracováno ${r.processed.length}, dohledáno ${r.reconciled.length}`);
      }
    } catch (e) {
      log.error('[worker] runDue selhal', e);
    }
    if (Date.now() - lastMetrics >= metricsEvery) {
      lastMetrics = Date.now();
      try {
        // Výčet agentur je mimo rozhraní Store (jediný dotaz workeru napříč tenanty).
        const { rows } = await pool.query<{ id: string }>('select id from agencies order by seq');
        let n = 0;
        for (const a of rows) {
          if (stopping) break;
          n += await services.reports.collectMetrics(a.id);
        }
        const purged = await auth.purgeExpired();
        log.info(`[worker] metriky: ${n} řádků pro ${rows.length} agentur; smazáno ${purged} prošlých session`);
      } catch (e) {
        log.error('[worker] collectMetrics selhal', e);
      }
    }
  }

  const loop = (async () => {
    while (!stopping) {
      await tick();
      if (!stopping) await sleep(publishEvery);
    }
  })();

  return {
    async stop() {
      stopping = true;
      wake?.();
      await loop;
    },
  };
}

async function main() {
  const cfg = loadConfig();
  const pool = createPool(cfg.databaseUrl);
  const { services } = buildServices(pool, cfg);
  console.info(`[worker] start; AI: ${services.ai.label}; publikace: ${services.deps.publisher.label}`);
  const w = startWorker(services, pool);
  const shutdown = async (sig: string) => {
    console.info(`[worker] ${sig}: dokončuji rozpracovanou iteraci…`);
    await w.stop();
    await pool.end();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
