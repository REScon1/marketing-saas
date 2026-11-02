import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GlobalSetupContext } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

/**
 * Testy potřebují Postgres. Použije TEST_DATABASE_URL, jinak zkusí spustit lokální
 * jednorázový cluster přes scripts/test-db.sh (Postgres 16 binárky v /usr/lib/postgresql/16/bin).
 */
export default function setup({ provide }: GlobalSetupContext) {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const script = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'test-db.sh');
    try {
      const out = execFileSync(script, ['start'], { encoding: 'utf8' });
      url = /TEST_DATABASE_URL=(\S+)/.exec(out)?.[1];
    } catch (e) {
      throw new Error(`Chybí TEST_DATABASE_URL a lokální Postgres se nepodařilo spustit: ${(e as Error).message}`);
    }
  }
  if (!url) throw new Error('Chybí TEST_DATABASE_URL');
  provide('testDatabaseUrl', url);
}
