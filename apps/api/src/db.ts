import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export interface PoolOptions {
  /** Volitelné schéma (testy: každý soubor má vlastní). Nastaví search_path pro každé spojení. */
  schema?: string;
  max?: number;
}

export function createPool(connectionString: string, opts: PoolOptions = {}): pg.Pool {
  const options = ['-c TimeZone=UTC'];
  if (opts.schema) options.push(`-c search_path=${opts.schema}`);
  const pool = new pg.Pool({ connectionString, max: opts.max ?? 10, options: options.join(' ') });
  // Chyba nečinného spojení (restart DB) nesmí shodit proces.
  pool.on('error', (e) => console.error('[pg] idle client error', e.message));
  return pool;
}

/**
 * Jednoduchý runner migrací: soubory NNN_*.sql se aplikují v pořadí, každý v jedné transakci,
 * a zapíšou se do schema_migrations. Souběžné spuštění chrání advisory lock.
 */
export async function migrate(pool: pg.Pool, dir = MIGRATIONS_DIR, log: (m: string) => void = () => {}): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query(`select pg_advisory_lock(hashtext('ms_migrations:' || current_schema()))`);
    await client.query(`create table if not exists schema_migrations (
      name text primary key, applied_at timestamptz not null default now())`);
    const done = new Set((await client.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(join(dir, f), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [f]);
        await client.query('commit');
      } catch (e) {
        await client.query('rollback');
        throw new Error(`Migrace ${f} selhala: ${(e as Error).message}`);
      }
      applied.push(f);
      log(`migrace ${f} aplikována`);
    }
  } finally {
    await client.query(`select pg_advisory_unlock(hashtext('ms_migrations:' || current_schema()))`).catch(() => {});
    client.release();
  }
  return applied;
}
