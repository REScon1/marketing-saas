export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  /** Povolené originy pro POST (CSRF). Čárkou oddělený seznam v APP_ORIGIN. */
  appOrigins: string[];
  production: boolean;
  trustProxy: boolean;
  /** Spustit publikační worker přímo v procesu serveru (jednoduché nasazení na jeden stroj). */
  workerInProcess: boolean;
  anthropicApiKey: string | null;
  aiModel: string;
  publisher: 'simulated' | 'ayrshare';
  ayrshareApiKey: string | null;
  /** Adresář se sestaveným webem (volitelné). */
  webDist: string | null;
}

const bool = (v: string | undefined) => v === '1' || v === 'true' || v === 'yes';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Chybí DATABASE_URL (viz apps/api/.env.example)');
  const production = env.NODE_ENV === 'production';
  const appOrigins = (env.APP_ORIGIN ?? (production ? '' : 'http://localhost:5173,http://localhost:3001'))
    .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  if (production && appOrigins.length === 0) throw new Error('V produkci je APP_ORIGIN povinný');
  const publisher = (env.PUBLISHER ?? 'simulated') as Config['publisher'];
  if (!['simulated', 'ayrshare'].includes(publisher)) throw new Error(`Neznámý PUBLISHER: ${publisher}`);
  return {
    databaseUrl,
    port: Number(env.PORT ?? 3001),
    host: env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1'),
    appOrigins,
    production,
    trustProxy: bool(env.TRUST_PROXY),
    workerInProcess: bool(env.WORKER_IN_PROCESS),
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || null,
    aiModel: env.AI_MODEL?.trim() || 'claude-sonnet-5-5',
    publisher,
    ayrshareApiKey: env.AYRSHARE_API_KEY?.trim() || null,
    webDist: env.WEB_DIST ?? null,
  };
}
