import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { httpStatus, invoke, invokePublic, isDomainError, type Services } from '@ms/core';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { AuthRepo, SESSION_COOKIE, SESSION_TTL_MS } from './auth.js';
import type { Config } from './config.js';
import { RateLimiter } from './rate-limit.js';

export interface AppOptions {
  services: Services;
  pool: pg.Pool;
  config: Pick<Config, 'appOrigins' | 'production' | 'trustProxy' | 'webDist'>;
  logger?: boolean;
  /** Limity (testy je snižují). */
  limits?: { publicPerMinute?: number; loginPerMinute?: number };
}

type ErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } };

const errorBody = (code: string, message: string, details: Record<string, unknown> = {}): ErrorBody => ({ error: { code, message, details } });

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
  }
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const { services, pool, config } = opts;
  const app = Fastify({
    logger: opts.logger ?? true,
    trustProxy: config.trustProxy,
    bodyLimit: 6 * 1024 * 1024, // obrázky postů jako data URI (max. 4 × ~1 MB)
  });
  const auth = new AuthRepo(pool);
  const publicLimiter = new RateLimiter(opts.limits?.publicPerMinute ?? 60, 60_000);
  const loginLimiter = new RateLimiter(opts.limits?.loginPerMinute ?? 10, 60_000);

  await app.register(cookie);

  // JSON parser, který snese prázdné tělo (např. logout bez dat).
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (!text.trim()) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch {
      const err = new Error('Tělo požadavku není platný JSON') as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // ---------- CSRF: JSON + Origin ----------
  // Prohlížeč neumí cross-site poslat application/json bez CORS preflightu (a CORS nepovolujeme),
  // Origin se navíc kontroluje proti APP_ORIGIN. Cookie je SameSite=Lax.
  app.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'POST') return;
    const ct = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (ct !== 'application/json') {
      return reply.code(415).send(errorBody('unsupported_media_type', 'Požadavek musí mít Content-Type: application/json'));
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !config.appOrigins.includes(origin.replace(/\/$/, ''))) {
      return reply.code(403).send(errorBody('forbidden', 'Nepovolený původ požadavku'));
    }
    if (origin === undefined && req.headers['sec-fetch-site'] === 'cross-site') {
      return reply.code(403).send(errorBody('forbidden', 'Nepovolený původ požadavku'));
    }
  });

  // ---------- Chyby ----------
  const sendError = (req: FastifyRequest, reply: FastifyReply, e: unknown) => {
    if (isDomainError(e)) {
      return reply.code(httpStatus(e)).send(errorBody(e.code, e.message, e.details));
    }
    const status = (e as { statusCode?: number }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.code(status).send(errorBody('invalid', (e as Error).message));
    }
    req.log.error({ err: e }, 'neošetřená chyba');
    return reply.code(500).send(errorBody('internal', 'Interní chyba serveru'));
  };
  app.setErrorHandler((e, req, reply) => sendError(req, reply, e));

  // ---------- Session ----------
  const cookieOpts = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.production,
  };

  async function requireSession(req: FastifyRequest, reply: FastifyReply) {
    const token = req.cookies[SESSION_COOKIE];
    const userId = token ? await auth.userIdForToken(token) : null;
    if (!userId) {
      return reply.code(401).send(errorBody('unauthorized', 'Nejste přihlášeni'));
    }
    req.userId = userId;
  }

  const argsOf = (body: unknown): unknown[] => {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw Object.assign(new Error('Tělo musí být objekt { "args": [...] }'), { statusCode: 422 });
    }
    const args = (body as { args?: unknown }).args ?? [];
    if (!Array.isArray(args)) throw Object.assign(new Error('args musí být pole'), { statusCode: 422 });
    return args;
  };

  // ---------- Routy ----------
  app.get('/healthz', async (_req, reply) => {
    await pool.query('select 1');
    return reply.send({ ok: true });
  });

  app.post('/api/auth/login', async (req, reply) => {
    const rl = loginLimiter.take(`login:${req.ip}`);
    if (!rl.ok) {
      return reply.code(429).header('retry-after', rl.retryAfterSec).send(errorBody('rate_limited', 'Příliš mnoho pokusů, zkuste to za chvíli'));
    }
    const { email, password } = (req.body ?? {}) as { email?: unknown; password?: unknown };
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password || password.length > 500) {
      return reply.code(422).send(errorBody('invalid', 'Vyplňte e-mail a heslo'));
    }
    const userId = await auth.checkPassword(email.trim(), password);
    if (!userId) return reply.code(401).send(errorBody('unauthorized', 'Neplatný e-mail nebo heslo'));
    const { token } = await auth.createSession(userId, { userAgent: req.headers['user-agent'], ip: req.ip });
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOpts, maxAge: Math.floor(SESSION_TTL_MS / 1000) });
    return reply.send({ result: await me(userId) });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await auth.deleteSession(token);
    reply.clearCookie(SESSION_COOKIE, cookieOpts);
    return reply.send({ result: null });
  });

  async function me(userId: string) {
    const user = await services.deps.store.users.get(userId);
    return { user, agencies: await services.tenancy.myAgencies(userId) };
  }

  app.get('/api/auth/me', { preHandler: requireSession }, async (req, reply) => reply.send({ result: await me(req.userId!) }));

  app.post<{ Params: { method: string } }>('/api/rpc/:method', { preHandler: requireSession }, async (req, reply) => {
    const agencyId = req.headers['x-agency-id'];
    if (typeof agencyId !== 'string' || !agencyId) {
      return reply.code(422).send(errorBody('invalid', 'Chybí hlavička x-agency-id'));
    }
    const args = argsOf(req.body);
    // Actor se odvozuje z ŽIVÉHO členství na každý request – odebraný člen ztratí přístup okamžitě.
    const actor = await services.tenancy.resolveActor(req.userId!, agencyId);
    const result = await invoke(services, actor, req.params.method, args);
    return reply.send({ result: result ?? null });
  });

  app.post<{ Params: { method: string } }>('/api/public/:method', async (req, reply) => {
    const rl = publicLimiter.take(`public:${req.ip}`);
    if (!rl.ok) {
      return reply.code(429).header('retry-after', rl.retryAfterSec).send(errorBody('rate_limited', 'Příliš mnoho požadavků, zkuste to za chvíli'));
    }
    const result = await invokePublic(services, `public.${req.params.method.replace(/^public\./, '')}`, argsOf(req.body));
    return reply.send({ result: result ?? null });
  });

  // ---------- Volitelně statický web ----------
  const here = dirname(fileURLToPath(import.meta.url));
  const webDist = config.webDist ? resolve(config.webDist) : join(here, '..', '..', 'web', 'dist');
  if (existsSync(join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send(errorBody('not_found', 'Nenalezeno'));
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send(errorBody('not_found', 'Nenalezeno')));
  }

  return app;
}
