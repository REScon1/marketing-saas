import { createServices, type Services } from '@ms/core';
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { selectAdapters } from './adapters/index.js';
import type { Config } from './config.js';
import { PgStore } from './pg-store.js';

/** Hodiny, které jde dočasně přenastavit (seed vytváří historii „v minulosti“). */
export class OverridableClock {
  private fixed: number | null = null;
  now = () => (this.fixed === null ? new Date() : new Date(this.fixed));
  set = (iso: string | null) => {
    this.fixed = iso === null ? null : Date.parse(iso);
  };
}

export function buildServices(pool: pg.Pool, cfg: Config, clock = new OverridableClock()): { services: Services; store: PgStore; clock: OverridableClock } {
  const store = new PgStore(pool);
  const services = createServices({
    store,
    clock: clock.now,
    newId: () => randomUUID(),
    // Schvalovací token je jediná „autentizace“ hosta: 32 náhodných bajtů.
    newToken: () => randomBytes(32).toString('base64url'),
    ...selectAdapters(cfg),
  });
  return { services, store, clock };
}
