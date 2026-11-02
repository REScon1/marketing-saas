import { describe, expect, it } from 'vitest';
import { MemoryStore } from './memory-store.js';
import { makeTestApp, storeContract } from './testing/index.js';
import type { Actor } from './types.js';

storeContract('memory', async () => ({ store: new MemoryStore() }));

async function setup() {
  const app = makeTestApp();
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
  return { ...app, s, agency, owner, client, other, brand, otherBrand, clientActor };
}

async function approvedPost(ctx: Awaited<ReturnType<typeof setup>>) {
  const { s, owner, brand, clientActor } = ctx;
  const post = await s.content.createPost(owner, { brandId: brand.id, body: 'Čerstvé rohlíky od 6:00', networks: ['facebook', 'instagram'] });
  await s.content.submitForApproval(owner, post.id);
  await s.content.decide(clientActor, post.id, 'approved');
  return post;
}

describe('tenancy a oprávnění', () => {
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
    // Podvržené agencyId v Actor bez členství neprojde
    await expect(s.tenancy.resolveActor(b.user.id, ctx.agency.id)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('klient vidí jen svého klienta a ne rozpracované koncepty', async () => {
    const ctx = await setup();
    const { s, owner, brand, otherBrand, clientActor } = ctx;
    const draft = await s.content.createPost(owner, { brandId: brand.id, body: 'koncept', networks: ['facebook'] });
    const foreign = await s.content.createPost(owner, { brandId: otherBrand.id, body: 'cizí', networks: ['facebook'] });
    await s.content.submitForApproval(owner, foreign.id);
    expect((await s.catalog.listBrands(clientActor)).map((b) => b.id)).toEqual([brand.id]);
    expect(await s.content.listPosts(clientActor)).toEqual([]);
    await expect(s.content.getPost(clientActor, draft.id)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(s.content.getPost(clientActor, foreign.id)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(s.catalog.getBrand(clientActor, otherBrand.id)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(s.content.createPost(clientActor, { brandId: brand.id, body: 'x', networks: ['facebook'] })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(s.tenancy.listMembers(clientActor)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('klient nevidí token schvalovacího odkazu ani úlohy publikace', async () => {
    const ctx = await setup();
    const post = await ctx.s.content.createPost(ctx.owner, { brandId: ctx.brand.id, body: 'x', networks: ['facebook'] });
    await ctx.s.content.submitForApproval(ctx.owner, post.id);
    const d = await ctx.s.content.getPost(ctx.clientActor, post.id);
    expect(d.approvals[0]?.token).toBe('');
    expect(d.jobs).toEqual([]);
  });

  it('role klient vyžaduje klienta; posledního majitele nejde odebrat', async () => {
    const { s, owner } = await setup();
    await expect(s.tenancy.inviteMember(owner, { email: 'x@x.cz', name: 'X', role: 'client' })).rejects.toMatchObject({ code: 'invalid' });
    const members = await s.tenancy.listMembers(owner);
    const own = members.find((m) => m.role === 'owner')!;
    await expect(s.tenancy.removeMember(owner, own.id)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('odebrané členství přestane platit hned (živé membership)', async () => {
    const { s, owner, agency, clientActor } = await setup();
    const m = (await s.tenancy.listMembers(owner)).find((x) => x.userId === clientActor.userId)!;
    await s.tenancy.removeMember(owner, m.id);
    await expect(s.tenancy.resolveActor(clientActor.userId, agency.id)).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('schvalování', () => {
  it('kontrola značky blokuje odeslání se zakázaným slovem', async () => {
    const { s, owner, brand } = await setup();
    const p = await s.content.createPost(owner, { brandId: brand.id, body: 'Nejlevnější rohlíky ve městě', networks: ['facebook'] });
    await expect(s.content.submitForApproval(owner, p.id)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('klient schválí v portálu; změna obsahu schválení zruší', async () => {
    const ctx = await setup();
    const { s, owner, clientActor } = ctx;
    const post = await approvedPost(ctx);
    expect((await s.content.getPost(owner, post.id)).post.status).toBe('approved');
    const edited = await s.content.updatePost(owner, post.id, { body: 'Čerstvé rohlíky od 5:30' });
    expect(edited.status).toBe('draft');
    expect(edited.version).toBe(2);
    // koncept klient nevidí, takže ho nemůže ani schválit
    await expect(s.content.decide(clientActor, post.id, 'approved')).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('host schválí přes odkaz; stará verze odkazu po úpravě neplatí', async () => {
    const { s, owner, brand } = await setup();
    const post = await s.content.createPost(owner, { brandId: brand.id, body: 'v1', networks: ['facebook'] });
    const { approval } = await s.content.submitForApproval(owner, post.id);
    const token = approval!.token;
    const view = await s.content.getPublicApproval(token);
    expect(view.post.body).toBe('v1');
    expect(view.isCurrent).toBe(true);
    // agentura mezitím upraví a pošle znovu
    await s.content.updatePost(owner, post.id, { body: 'v2' });
    await expect(s.content.decideByToken(token, { name: 'Jana', decision: 'approved' })).rejects.toMatchObject({ code: 'invalid_transition' });
    const { approval: a2 } = await s.content.submitForApproval(owner, post.id);
    const r = await s.content.decideByToken(a2!.token, { name: 'Jana', decision: 'changes_requested', note: 'Doplňte cenu' });
    expect(r.post.status).toBe('changes_requested');
    const d = await s.content.getPost(owner, post.id);
    expect(d.comments.at(-1)).toMatchObject({ authorName: 'Jana', authorRole: 'guest', body: 'Doplňte cenu' });
  });

  it('vrácení k úpravě vyžaduje komentář; odkaz vyprší', async () => {
    const { s, owner, brand, clock } = await setup();
    const post = await s.content.createPost(owner, { brandId: brand.id, body: 'x', networks: ['facebook'] });
    const { approval } = await s.content.submitForApproval(owner, post.id);
    await expect(s.content.decideByToken(approval!.token, { name: 'J', decision: 'changes_requested' })).rejects.toMatchObject({ code: 'invalid' });
    clock.advance(15 * 864e5);
    await expect(s.content.decideByToken(approval!.token, { name: 'J', decision: 'approved' })).rejects.toMatchObject({ code: 'expired' });
  });

  it('značka bez povinného schválení klientem jde rovnou do approved', async () => {
    const { s, owner, otherBrand } = await setup();
    await s.catalog.updateBrand(owner, otherBrand.id, { requiresClientApproval: false });
    const p = await s.content.createPost(owner, { brandId: otherBrand.id, body: 'x', networks: ['facebook'] });
    const r = await s.content.submitForApproval(owner, p.id);
    expect(r.post.status).toBe('approved');
    expect(r.approval).toBeNull();
  });

  it('souběžná úprava se stejnou verzí skončí konfliktem', async () => {
    const { s, owner, brand } = await setup();
    const p = await s.content.createPost(owner, { brandId: brand.id, body: 'x', networks: ['facebook'] });
    await s.content.updatePost(owner, p.id, { body: 'a' }, p.updatedAt);
    await expect(s.content.updatePost(owner, p.id, { body: 'b' }, p.updatedAt)).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('publikace přes outbox', () => {
  it('naplánování vyžaduje připojené účty', async () => {
    const ctx = await setup();
    const { s, owner, clientActor, brand } = ctx;
    const p = await s.content.createPost(owner, { brandId: brand.id, body: 'x', networks: ['linkedin'] });
    await s.content.submitForApproval(owner, p.id);
    await s.content.decide(clientActor, p.id, 'approved');
    await expect(s.content.schedule(owner, p.id, '2026-11-05T10:00:00Z')).rejects.toMatchObject({ code: 'invalid' });
  });

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

  it('úprava naplánovaného postu zruší čekající úlohy a vrátí ho ke schválení', async () => {
    const ctx = await setup();
    const { s, owner, clock } = ctx;
    const post = await approvedPost(ctx);
    await s.content.schedule(owner, post.id, '2026-11-05T10:00:00Z');
    await s.content.updatePost(owner, post.id, { body: 'nový text' });
    clock.set('2026-11-05T10:00:30Z');
    expect((await s.publishing.runDue()).processed).toEqual([]);
    const d = await s.content.getPost(owner, post.id);
    expect(d.post.status).toBe('draft');
    expect(d.jobs.every((j) => j.status === 'cancelled')).toBe(true);
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

describe('reporty', () => {
  it('měsíční report sečte metriky publikovaných postů a klient ho vidí', async () => {
    const ctx = await setup();
    const { s, owner, clock, agency, brand, clientActor } = ctx;
    const post = await approvedPost(ctx);
    await s.content.schedule(owner, post.id, '2026-11-05T10:00:00Z');
    clock.set('2026-11-05T10:00:30Z');
    await s.publishing.runDue();
    clock.set('2026-11-12T10:00:00Z');
    expect(await s.reports.collectMetrics(agency.id)).toBe(2);
    const r = await s.reports.monthly(clientActor, brand.id, '2026-11');
    expect(r.totals.posts).toBe(1);
    expect(r.totals.reach).toBeGreaterThan(0);
    expect(r.byNetwork.map((n) => n.network).sort()).toEqual(['facebook', 'instagram']);
    expect(r.topPosts[0]?.post.id).toBe(post.id);
    expect(r.summary).toContain('Pekárna U Lípy');
    await expect(s.reports.monthly(owner, brand.id, '2026-13')).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('AI asistent', () => {
  it('vrátí varianty s kontrolou značky; klient ho volat nesmí', async () => {
    const { s, owner, brand, clientActor } = await setup();
    const v = await s.ai.draft(owner, { brandId: brand.id, brief: 'nové kváskové pečivo každý pátek', networks: ['instagram'] });
    expect(v).toHaveLength(3);
    expect(v[0]?.body).toContain('Nové kváskové pečivo');
    expect(Array.isArray(v[0]?.issues)).toBe(true);
    await expect(s.ai.draft(clientActor as Actor, { brandId: brand.id, brief: 'x', networks: [] })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('veřejný odkaz', () => {
  it('komentář hosta nevrací interní identifikátory', async () => {
    const { s, owner, brand } = await setup();
    const post = await s.content.createPost(owner, { brandId: brand.id, body: 'x', networks: ['facebook'] });
    const { approval } = await s.content.submitForApproval(owner, post.id);
    const c = await s.content.addCommentByToken(approval!.token, { name: 'Jana', body: 'Dobré' });
    expect(Object.keys(c).sort()).toEqual(['authorName', 'authorRole', 'body', 'createdAt']);
  });
});
