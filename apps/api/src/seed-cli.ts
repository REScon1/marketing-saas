// Naplní databázi demo daty přes skutečné služby a nastaví hesla třem personám.
import { seedDemo } from '@ms/core';
import { AuthRepo } from './auth.js';
import { loadConfig } from './config.js';
import { buildServices } from './container.js';
import { createPool, migrate } from './db.js';

const DEMO_SLUG = 'studio-dobry-den';
const DEMO_PASSWORD = 'demo1234';

const cfg = loadConfig();
if (cfg.production && process.env.ALLOW_DEMO_SEED !== '1') {
  console.error('Seed v produkci je zakázaný (nastavte ALLOW_DEMO_SEED=1, pokud opravdu víte, co děláte).');
  process.exit(1);
}
const pool = createPool(cfg.databaseUrl);
try {
  await migrate(pool, undefined, (m) => console.info(m));
  // Seed vždy se simulovanou publikací a šablonovým asistentem: nic se nesmí poslat ven.
  const { services, store, clock } = buildServices(pool, { ...cfg, anthropicApiKey: null, publisher: 'simulated' });
  if (await store.agencies.getBySlug(DEMO_SLUG)) {
    console.error(`Demo agentura „${DEMO_SLUG}“ už existuje – seed nic nezměnil.`);
    process.exitCode = 1;
  } else {
    // Celý seed v jedné transakci: buď všechno, nebo nic.
    const result = await store.tx(() => seedDemo(services, clock));
    const auth = new AuthRepo(pool);
    for (const p of result.personas) await auth.setPassword(p.userId, DEMO_PASSWORD);
    console.info(`\nDemo data vytvořena (agentura ${result.agencyId}). Přihlášení (heslo ${DEMO_PASSWORD}):`);
    for (const p of result.personas) console.info(`  ${p.label.padEnd(32)} ${p.email}`);
  }
} finally {
  await pool.end();
}
