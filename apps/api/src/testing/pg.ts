import { randomBytes } from 'node:crypto';
import { inject } from 'vitest';
import { createPool, migrate } from '../db.js';
import { PgStore } from '../pg-store.js';

/** Čerstvé schéma s aplikovanými migracemi. Každý testovací soubor má vlastní, po testech se smaže. */
export async function makeTestDb() {
  const url = inject('testDatabaseUrl');
  const schema = `t_${randomBytes(6).toString('hex')}`;
  const admin = createPool(url, { max: 1 });
  await admin.query(`create schema ${schema}`);
  const pool = createPool(url, { schema, max: 10 });
  await migrate(pool);
  const store = new PgStore(pool);
  return {
    url, schema, pool, store,
    async cleanup() {
      await pool.end();
      await admin.query(`drop schema ${schema} cascade`);
      await admin.end();
    },
  };
}
