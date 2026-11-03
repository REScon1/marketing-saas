import { makeTestApp } from '@ms/core/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { AuthRepo } from './auth.js';
import { makeTestDb } from './testing/pg.js';

const ORIGIN = 'http://localhost:5173';
let db: Awaited<ReturnType<typeof makeTestDb>>;
let app: FastifyInstance;
let ctx: Awaited<ReturnType<typeof seed>>;

async function seed() {
  const { services: s } = makeTestApp({ store: db.store });
  const { agency, user } = await s.tenancy.registerAgency({ agencyName: 'Studio', ownerEmail: 'owner@test.cz', ownerName: 'Olga' });
  const owner = await s.tenancy.resolveActor(user.id, agency.id);
  const client = await s.catalog.createClient(owner, { name: 'Pekárna' });
  const brand = await s.catalog.createBrand(owner, { clientId: client.id, name: 'Pekárna U Lípy' });
  const cm = await s.tenancy.inviteMember(owner, { email: 'klient@test.cz', name: 'Karel', role: 'client', clientId: client.id });
  const other = await s.tenancy.registerAgency({ agencyName: 'Jiná', ownerEmail: 'jiny@test.cz', ownerName: 'Jiný' });
  const post = await s.content.createPost(owner, { brandId: brand.id, body: 'Rohlíky', networks: ['facebook'] });
  const { approval } = await s.content.submitForApproval(owner, post.id);
  const auth = new AuthRepo(db.pool);
  await auth.setPassword(user.id, 'tajneheslo');
  await auth.setPassword(cm.userId, 'klientheslo');
  return { s, agency, other, user, owner, brand, post, token: approval!.token };
}

beforeAll(async () => {
  db = await makeTestDb();
  ctx = await seed();
  app = await buildApp({
    services: ctx.s, pool: db.pool, logger: false,
    config: { appOrigins: [ORIGIN], production: false, trustProxy: false, webDist: '/nonexistent' },
    limits: { publicPerMinute: 5, loginPerMinute: 100 },
  });
});
afterAll(async () => {
  await app?.close();
  await db?.cleanup();
});

const json = { 'content-type': 'application/json' };

async function login(email: string, password: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { ...json, origin: ORIGIN }, payload: { email, password } });
  const set = r.cookies.find((c) => c.name === 'ms_session');
  return { r, cookie: set ? `ms_session=${set.value}` : '', set };
}

const rpc = (cookie: string, method: string, args: unknown[], agencyId = ctx.agency.id) =>
  app.inject({ method: 'POST', url: `/api/rpc/${method}`, headers: { ...json, cookie, 'x-agency-id': agencyId }, payload: { args } });

describe('HTTP API', () => {
  it('healthz', async () => {
    expect((await app.inject('/healthz')).json()).toEqual({ ok: true });
  });

  it('login nastaví httpOnly SameSite=Lax cookie; špatné heslo 401', async () => {
    const bad = await login('owner@test.cz', 'spatne');
    expect(bad.r.statusCode).toBe(401);
    expect(bad.r.json().error.code).toBe('unauthorized');
    expect((await login('nikdo@test.cz', 'x')).r.statusCode).toBe(401);
    const { r, set } = await login('OWNER@test.cz', 'tajneheslo');
    expect(r.statusCode).toBe(200);
    expect(set).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(r.json().result.agencies[0].agency.id).toBe(ctx.agency.id);
  });

  it('do sessions se ukládá jen hash tokenu', async () => {
    const { set } = await login('owner@test.cz', 'tajneheslo');
    const rows = await db.pool.query('select encode(token_hash, $1) as h from sessions', ['escape']);
    expect(rows.rows.some((r) => r.h === set!.value)).toBe(false);
  });

  it('RPC vyžaduje session a vrací { result }', async () => {
    expect((await rpc('', 'content.listPosts', [])).statusCode).toBe(401);
    const { cookie } = await login('owner@test.cz', 'tajneheslo');
    const r = await rpc(cookie, 'content.listPosts', []);
    expect(r.statusCode).toBe(200);
    expect(r.json().result.map((p: { id: string }) => p.id)).toEqual([ctx.post.id]);
  });

  it('cizí x-agency-id -> 403, neznámá metoda -> 404, chybějící hlavička -> 422', async () => {
    const { cookie } = await login('owner@test.cz', 'tajneheslo');
    const r = await rpc(cookie, 'content.listPosts', [], ctx.other.agency.id);
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('forbidden');
    expect((await rpc(cookie, 'publishing.runDue', [])).statusCode).toBe(404);
    expect((await rpc(cookie, 'constructor', [])).statusCode).toBe(404);
    const noHeader = await app.inject({ method: 'POST', url: '/api/rpc/content.listPosts', headers: { ...json, cookie }, payload: { args: [] } });
    expect(noHeader.statusCode).toBe(422);
  });

  it('klient dostane 403 na catalog.createClient', async () => {
    const { cookie } = await login('klient@test.cz', 'klientheslo');
    const r = await rpc(cookie, 'catalog.createClient', [{ name: 'Hack' }]);
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toMatchObject({ code: 'forbidden' });
  });

  it('doménová chyba se vrátí s kódem a detaily', async () => {
    const { cookie } = await login('owner@test.cz', 'tajneheslo');
    const r = await rpc(cookie, 'catalog.createClient', [{ name: '' }]);
    expect(r.statusCode).toBe(422);
    expect(r.json().error).toMatchObject({ code: 'invalid', details: { field: 'název klienta' } });
  });

  it('CSRF: jiný content-type 415, cizí Origin 403', async () => {
    const { cookie } = await login('owner@test.cz', 'tajneheslo');
    const form = await app.inject({
      method: 'POST', url: '/api/rpc/content.listPosts', headers: { cookie, 'x-agency-id': ctx.agency.id, 'content-type': 'text/plain' }, payload: '{"args":[]}',
    });
    expect(form.statusCode).toBe(415);
    const evil = await app.inject({
      method: 'POST', url: '/api/rpc/content.listPosts', headers: { ...json, cookie, origin: 'https://evil.example', 'x-agency-id': ctx.agency.id }, payload: { args: [] },
    });
    expect(evil.statusCode).toBe(403);
    const ok = await app.inject({
      method: 'POST', url: '/api/rpc/content.listPosts', headers: { ...json, cookie, origin: ORIGIN, 'x-agency-id': ctx.agency.id }, payload: { args: [] },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('logout zneplatní session', async () => {
    const { cookie } = await login('owner@test.cz', 'tajneheslo');
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(200);
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...json, cookie } });
    expect(out.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('veřejné schválení přes token bez session; rate limit 429', async () => {
    const get = await app.inject({ method: 'POST', url: '/api/public/public.getApproval', headers: json, payload: { args: [ctx.token] }, remoteAddress: '10.0.0.1' });
    expect(get.statusCode).toBe(200);
    expect(get.json().result.post.body).toBe('Rohlíky');
    const bad = await app.inject({ method: 'POST', url: '/api/public/getApproval', headers: json, payload: { args: ['neexistuje'] }, remoteAddress: '10.0.0.1' });
    expect(bad.statusCode).toBe(404);
    const dec = await app.inject({
      method: 'POST', url: '/api/public/decide', headers: json, payload: { args: [ctx.token, { name: 'Jana', decision: 'approved' }] }, remoteAddress: '10.0.0.1',
    });
    expect(dec.statusCode).toBe(200);
    expect(dec.json().result.post.status).toBe('approved');
    let last = 0;
    for (let i = 0; i < 5; i++) {
      last = (await app.inject({ method: 'POST', url: '/api/public/getApproval', headers: json, payload: { args: [ctx.token] }, remoteAddress: '10.0.0.1' })).statusCode;
    }
    expect(last).toBe(429);
    // jiná IP má vlastní limit
    expect((await app.inject({ method: 'POST', url: '/api/public/getApproval', headers: json, payload: { args: [ctx.token] }, remoteAddress: '10.0.0.2' })).statusCode).toBe(200);
  });

  it('návrh s obrázky jako data URI se vejde do limitu těla (6 MB); větší tělo -> 413', async () => {
    const { cookie } = await login('owner@test.cz', 'tajneheslo');
    const img = `data:image/jpeg;base64,${'A'.repeat(1_400_000)}`;
    const design = {
      format: 'carousel', templateId: 'photo', aspect: '4:5', seed: 3,
      slides: [{ headline: 'Titulní', mediaUrl: img }, { headline: 'Dva', mediaUrl: img }, { headline: 'Tři', mediaUrl: img }],
    };
    const r = await rpc(cookie, 'content.createPost', [{ brandId: ctx.brand.id, body: 'Karusel', networks: ['facebook'], design }]);
    expect(r.statusCode).toBe(200);
    expect(r.json().result.design.slides).toHaveLength(3);
    const got = await rpc(cookie, 'content.getPost', [r.json().result.id]);
    expect(got.json().result.post.design.slides[2].mediaUrl).toBe(img);
    const huge = { ...design, slides: [...design.slides, ...design.slides] };
    expect((await rpc(cookie, 'content.createPost', [{ brandId: ctx.brand.id, body: 'x', networks: ['facebook'], design: huge }])).statusCode).toBe(413);
  });

  it('Studio RPC: koncepty a plán pro tým, klient 403', async () => {
    const { cookie } = await login('owner@test.cz', 'tajneheslo');
    const c = await rpc(cookie, 'ai.concepts', [{ brandId: ctx.brand.id, brief: 'Novinka: žitný chléb. Vydrží měkký tři dny.', format: 'reel', networks: ['instagram'], count: 2 }]);
    expect(c.statusCode).toBe(200);
    expect(c.json().result).toHaveLength(2);
    const created = await rpc(cookie, 'content.createFromConcept', [{ brandId: ctx.brand.id, concept: c.json().result[0] }]);
    expect(created.statusCode).toBe(200);
    expect(created.json().result.design.format).toBe('reel');
    const plan = await rpc(cookie, 'ai.planMonth', [{ brandId: ctx.brand.id, month: '2027-01', postsPerWeek: 2, networks: ['instagram'] }]);
    expect(plan.statusCode).toBe(200);
    expect(plan.json().result.length).toBeGreaterThan(5);
    const { cookie: klient } = await login('klient@test.cz', 'klientheslo');
    expect((await rpc(klient, 'ai.concepts', [{ brandId: ctx.brand.id, brief: 'x', format: 'image', networks: ['instagram'] }])).statusCode).toBe(403);
    expect((await rpc(klient, 'content.bulkCreateFromPlan', [{ brandId: ctx.brand.id, items: plan.json().result }])).statusCode).toBe(403);
  });

  it('nečekaná chyba -> 500 s obecnou zprávou', async () => {
    const { cookie } = await login('owner@test.cz', 'tajneheslo');
    // content.listPosts s filtrem, který rozbije SQL typ (neplatné datum) -> doménová invalid, ne 500
    const r = await rpc(cookie, 'content.listPosts', [{ from: 'neni-datum' }]);
    expect(r.statusCode).toBe(422);
    const orig = ctx.s.content.activity;
    ctx.s.content.activity = async () => {
      throw new Error('tajný detail');
    };
    try {
      const e = await rpc(cookie, 'content.activity', []);
      expect(e.statusCode).toBe(500);
      expect(e.json().error).toMatchObject({ code: 'internal', message: 'Interní chyba serveru' });
      expect(e.body).not.toContain('tajný');
    } finally {
      ctx.s.content.activity = orig;
    }
  });
});
