// Scénáře ze services.test.ts (packages/core) spuštěné proti Postgresu.
// Každý test má vlastní schéma: worker dotazy (claimDue, listUnknown) běží napříč agenturami.
import { makeTestApp, TestClock } from '@ms/core/testing';
import { seedDemo } from '@ms/core';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTestDb } from './testing/pg.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function setup() {
  const db = await makeTestDb();
  cleanups.push(db.cleanup);
  const app = makeTestApp({ store: db.store });
  const { services: s } = app;
  const { agency, user } = await s.tenancy.registerAgency({ agencyName: 'Studio Test', ownerEmail: 'owner@test.cz', ownerName: 'Olga Majitelová' });
  const owner = await s.tenancy.resolveActor(user.id, agency.id);
  const client = await s.catalog.createClient(owner, { name: 'Pekárna' });
  const other = await s.catalog.createClient(owner, { name: 'Fitko' });
  const brand = await s.catalog.createBrand(owner, { clientId: client.id, name: 'Pekárna U Lípy', profile: { bannedWords: ['nejlevnější'] } });
  const otherBrand = await s.catalog.createBrand(owner, { clientId: other.id, name: 'Fitko Brno' });
  await s.catalog.connectAccount(owner, { brandId: brand.id, network: 'facebook', handle: '@pekarna' });
  await s.catalog.connectAccount(owner, { brandId: brand.id, network: 'instagram', handle: '@pekarna' });
  const cm = await s.tenancy.inviteMember(owner, { email: 'klient@pekarna.cz', name: 'Karel Klient', role: 'client', clientId: client.id });
  const clientActor = await s.tenancy.resolveActor(cm.userId, agency.id);
  return { ...app, db, s, agency, owner, client, other, brand, otherBrand, clientActor };
}

async function approvedPost(ctx: Awaited<ReturnType<typeof setup>>) {
  const { s, owner, brand, clientActor } = ctx;
  const post = await s.content.createPost(owner, { brandId: brand.id, body: 'Čerstvé rohlíky od 6:00', networks: ['facebook', 'instagram'] });
  await s.content.submitForApproval(owner, post.id);
  await s.content.decide(clientActor, post.id, 'approved');
  return post;
}

describe('Postgres: tenancy a oprávnění', () => {
  it('uživatel cizí agentury nevidí nic a nemůže nic měnit (G4)', async () => {
    const ctx = await setup();
    const { s, brand } = ctx;
    const post = await s.content.createPost(ctx.owner, { brandId: brand.id, body: 'x', networks: ['facebook'] });
    const b = await s.tenancy.registerAgency({ agencyName: 'Konkurence', ownerEmail: 'b@b.cz', ownerName: 'B' });
    const intruder = await s.tenancy.resolveActor(b.user.id, b.agency.id);
    await expect(s.content.getPost(intruder, post.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(s.content.updatePost(intruder, post.id, { body: 'hack' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(s.catalog.getBrand(intruder, brand.id)).rejects.toMatchObject({ code: 'not_found' });
    expect(await s.content.listPosts(intruder)).toEqual([]);
    await expect(s.tenancy.resolveActor(b.user.id, ctx.agency.id)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('klient vidí jen svého klienta a ne koncepty', async () => {
    const ctx = await setup();
    const { s, owner, brand, otherBrand, clientActor } = ctx;
    const draft = await s.content.createPost(owner, { brandId: brand.id, body: 'koncept', networks: ['facebook'] });
    const foreign = await s.content.createPost(owner, { brandId: otherBrand.id, body: 'cizí', networks: ['facebook'] });
    await s.content.submitForApproval(owner, foreign.id);
    expect((await s.catalog.listBrands(clientActor)).map((b) => b.id)).toEqual([brand.id]);
    expect(await s.content.listPosts(clientActor)).toEqual([]);
    await expect(s.content.getPost(clientActor, draft.id)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(s.content.getPost(clientActor, foreign.id)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(s.content.createPost(clientActor, { brandId: brand.id, body: 'x', networks: ['facebook'] })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('odebrané členství přestane platit hned (živé membership)', async () => {
    const { s, owner, agency, clientActor } = await setup();
    const m = (await s.tenancy.listMembers(owner)).find((x) => x.userId === clientActor.userId)!;
    await s.tenancy.removeMember(owner, m.id);
    await expect(s.tenancy.resolveActor(clientActor.userId, agency.id)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('pozvání existujícího člena podruhé skončí konfliktem a transakce se vrátí', async () => {
    const { s, owner } = await setup();
    await expect(s.tenancy.inviteMember(owner, { email: 'klient@pekarna.cz', name: 'K', role: 'manager' })).rejects.toMatchObject({ code: 'conflict' });
    const audit = await s.content.activity(owner);
    expect(audit.filter((e) => e.action === 'member.invited')).toHaveLength(1);
  });
});

describe('Postgres: schvalování', () => {
  it('host schválí přes odkaz; stará verze odkazu po úpravě neplatí', async () => {
    const { s, owner, brand } = await setup();
    const post = await s.content.createPost(owner, { brandId: brand.id, body: 'v1', networks: ['facebook'] });
    const { approval } = await s.content.submitForApproval(owner, post.id);
    const token = approval!.token;
    const view = await s.content.getPublicApproval(token);
    expect(view.post.body).toBe('v1');
    expect(view.isCurrent).toBe(true);
    await s.content.updatePost(owner, post.id, { body: 'v2' });
    await expect(s.content.decideByToken(token, { name: 'Jana', decision: 'approved' })).rejects.toMatchObject({ code: 'invalid_transition' });
    const { approval: a2 } = await s.content.submitForApproval(owner, post.id);
    const r = await s.content.decideByToken(a2!.token, { name: 'Jana', decision: 'changes_requested', note: 'Doplňte cenu' });
    expect(r.post.status).toBe('changes_requested');
    const d = await s.content.getPost(owner, post.id);
    expect(d.comments.at(-1)).toMatchObject({ authorName: 'Jana', authorRole: 'guest', body: 'Doplňte cenu' });
  });

  it('odkaz vyprší', async () => {
    const { s, owner, brand, clock } = await setup();
    const post = await s.content.createPost(owner, { brandId: brand.id, body: 'x', networks: ['facebook'] });
    const { approval } = await s.content.submitForApproval(owner, post.id);
    clock.advance(15 * 864e5);
    await expect(s.content.decideByToken(approval!.token, { name: 'J', decision: 'approved' })).rejects.toMatchObject({ code: 'expired' });
  });

  it('souběžná úprava se stejnou verzí skončí konfliktem', async () => {
    const { s, owner, brand } = await setup();
    const p = await s.content.createPost(owner, { brandId: brand.id, body: 'x', networks: ['facebook'] });
    await s.content.updatePost(owner, p.id, { body: 'a' }, p.updatedAt);
    await expect(s.content.updatePost(owner, p.id, { body: 'b' }, p.updatedAt)).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('Postgres: publikace přes outbox', () => {
  it('úspěšná publikace na dvě sítě → published', async () => {
    const ctx = await setup();
    const { s, owner, clock, publisher } = ctx;
    const post = await approvedPost(ctx);
    await s.content.schedule(owner, post.id, '2026-11-05T10:00:00Z');
    expect((await s.publishing.runDue()).processed).toEqual([]);
    clock.set('2026-11-05T10:00:30Z');
    await s.publishing.runDue();
    const d = await s.content.getPost(owner, post.id);
    expect(d.post.status).toBe('published');
    expect(d.jobs.map((j) => j.status)).toEqual(['succeeded', 'succeeded']);
    expect(publisher.published.size).toBe(2);
  });

  it('ztracená odpověď → unknown → dohledání, bez duplicitní publikace (G2)', async () => {
    const ctx = await setup();
    const { s, owner, clock, publisher } = ctx;
    const post = await approvedPost(ctx);
    await s.content.schedule(owner, post.id, '2026-11-05T10:00:00Z');
    clock.set('2026-11-05T10:00:30Z');
    publisher.failNext('lost_response');
    await s.publishing.runDue();
    let d = await s.content.getPost(owner, post.id);
    expect(d.jobs.map((j) => j.status).sort()).toEqual(['succeeded', 'unknown']);
    expect(d.post.status).toBe('publishing');
    const r = await s.publishing.runDue();
    expect(r.reconciled).toHaveLength(1);
    d = await s.content.getPost(owner, post.id);
    expect(d.jobs.every((j) => j.status === 'succeeded')).toBe(true);
    expect(d.post.status).toBe('published');
    expect(publisher.published.size).toBe(2);
  });

  it('dočasná chyba → opakování s odstupem; trvalá chyba → failed a ruční retry', async () => {
    const ctx = await setup();
    const { s, owner, clock, publisher } = ctx;
    const post = await approvedPost(ctx);
    await s.content.schedule(owner, post.id, '2026-11-05T10:00:00Z');
    clock.set('2026-11-05T10:00:30Z');
    publisher.failNext('retryable', 'fatal');
    await s.publishing.runDue();
    let d = await s.content.getPost(owner, post.id);
    const pending = d.jobs.find((j) => j.status === 'pending')!;
    expect(pending.runAt > '2026-11-05T10:00:30Z').toBe(true);
    clock.advance(5 * 60 * 1000);
    await s.publishing.runDue();
    d = await s.content.getPost(owner, post.id);
    expect(d.post.status).toBe('failed');
    await s.content.retryFailed(owner, post.id);
    await s.publishing.runDue();
    d = await s.content.getPost(owner, post.id);
    expect(d.post.status).toBe('published');
  });

  it('dva souběžné workery nepublikují stejnou úlohu dvakrát', async () => {
    const ctx = await setup();
    const { s, owner, clock, publisher } = ctx;
    const post = await approvedPost(ctx);
    await s.content.schedule(owner, post.id, '2026-11-05T10:00:00Z');
    clock.set('2026-11-05T10:00:30Z');
    const [a, b] = await Promise.all([s.publishing.runDue(), s.publishing.runDue()]);
    expect(a.processed.length + b.processed.length).toBe(2);
    expect(publisher.published.size).toBe(2);
    expect((await s.content.getPost(owner, post.id)).post.status).toBe('published');
  });

  it('odplánování a znovunaplánování použije stejný klíč idempotence', async () => {
    const ctx = await setup();
    const { s, owner, clock } = ctx;
    const post = await approvedPost(ctx);
    await s.content.schedule(owner, post.id, '2026-11-05T10:00:00Z');
    await s.content.unschedule(owner, post.id);
    await s.content.schedule(owner, post.id, '2026-11-06T10:00:00Z');
    const d = await s.content.getPost(owner, post.id);
    expect(d.jobs).toHaveLength(2);
    expect(d.jobs.every((j) => j.status === 'pending' && j.runAt === '2026-11-06T10:00:00.000Z')).toBe(true);
    clock.set('2026-11-06T10:01:00Z');
    await s.publishing.runDue();
    expect((await s.content.getPost(owner, post.id)).post.status).toBe('published');
  });
});

describe('Postgres: reporty a seed', () => {
  it('měsíční report sečte metriky publikovaných postů a klient ho vidí', async () => {
    const ctx = await setup();
    const { s, owner, clock, agency, brand, clientActor } = ctx;
    const post = await approvedPost(ctx);
    await s.content.schedule(owner, post.id, '2026-11-05T10:00:00Z');
    clock.set('2026-11-05T10:00:30Z');
    await s.publishing.runDue();
    clock.set('2026-11-12T10:00:00Z');
    expect(await s.reports.collectMetrics(agency.id)).toBe(2);
    expect(await s.reports.collectMetrics(agency.id)).toBe(2); // upsert, žádné duplicity
    const r = await s.reports.monthly(clientActor, brand.id, '2026-11');
    expect(r.totals.posts).toBe(1);
    expect(r.totals.reach).toBeGreaterThan(0);
    expect(r.byNetwork.map((n) => n.network).sort()).toEqual(['facebook', 'instagram']);
    expect(r.topPosts[0]?.post.id).toBe(post.id);
    expect(r.summary).toContain('Pekárna U Lípy');
  });

  it('demo seed projde celý nad Postgresem', async () => {
    const db = await makeTestDb();
    cleanups.push(db.cleanup);
    const clock = new TestClock(Date.parse('2026-11-02T12:00:00Z'));
    const real = clock.t;
    const { services: s } = makeTestApp({ store: db.store, clock });
    const r = await seedDemo(s, { set: (iso) => (iso ? clock.set(iso) : (clock.t = real)) }, new Date(real));
    const owner = await s.tenancy.resolveActor(r.personas[0]!.userId, r.agencyId);
    const posts = await s.content.listPosts(owner);
    const by = (st: string) => posts.filter((p) => p.status === st).length;
    expect(by('published')).toBe(15);
    expect(by('in_review')).toBe(2);
    expect(by('scheduled')).toBe(2);
    expect(by('draft')).toBe(2);
    const client = await s.tenancy.resolveActor(r.personas[2]!.userId, r.agencyId);
    expect((await s.content.pendingApprovals(client)).length).toBe(1);
  });
});
