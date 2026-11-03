import { describe, expect, it } from 'vitest';
import { TemplateAssistant } from './assistant.js';
import type { Concept, ConceptsRequest } from './concepts.js';
import { MemoryStore } from './memory-store.js';
import { SimulatedMetrics, SimulatedPublisher } from './publisher.js';
import { invoke, isActorMethod } from './rpc.js';
import { createServices, defaultProfile, normalizeProfile } from './services.js';
import { makeTestApp, TestClock } from './testing/index.js';
import type { BrandProfile, DesignSpec } from './types.js';

async function setup() {
  const app = makeTestApp();
  const { services: s } = app;
  const { agency, user } = await s.tenancy.registerAgency({ agencyName: 'Studio Test', ownerEmail: 'owner@test.cz', ownerName: 'Olga' });
  const owner = await s.tenancy.resolveActor(user.id, agency.id);
  const client = await s.catalog.createClient(owner, { name: 'Pekárna' });
  const brand = await s.catalog.createBrand(owner, {
    clientId: client.id, name: 'Pekárna U Lípy',
    profile: { tone: 'Vřelý, tykáme.', bannedWords: ['nejlevnější'], defaultHashtags: ['#pekarna'], maxHashtags: 1, pillars: ['Kvas', 'Lidé'] },
  });
  await s.catalog.connectAccount(owner, { brandId: brand.id, network: 'instagram', handle: '@pekarna' });
  await s.catalog.connectAccount(owner, { brandId: brand.id, network: 'facebook', handle: '@pekarna' });
  const cm = await s.tenancy.inviteMember(owner, { email: 'klient@pekarna.cz', name: 'Karel', role: 'client', clientId: client.id });
  const clientActor = await s.tenancy.resolveActor(cm.userId, agency.id);
  const other = await s.tenancy.registerAgency({ agencyName: 'Konkurence', ownerEmail: 'x@konkurence.cz', ownerName: 'X' });
  const intruder = await s.tenancy.resolveActor(other.user.id, other.agency.id);
  return { ...app, s, owner, brand, clientActor, intruder };
}

const image: DesignSpec = { format: 'image', templateId: 'minimal', aspect: '4:5', slides: [{ kicker: 'NOVINKA', headline: 'Žitný chléb' }], seed: 1 };
const BRIEF = 'Novinka: žitný chléb se slunečnicí a lnem. Vydrží měkký i tři dny. Pečeme ho každé ráno od 6:30.';

describe('brand kit (normalizeProfile)', () => {
  it('doplní výchozí hodnoty a odmítne neplatné', () => {
    const p = normalizeProfile({
      ...defaultProfile(), secondaryColor: 'red', accentColor: '#ABCDEF', fontHeading: 'Comic Sans' as never, fontBody: 'Lora',
      pillars: [' Kvas ', '', ...Array.from({ length: 10 }, (_, i) => `P${i}`)], website: 'ftp://x', logoUrl: 'javascript:alert(1)',
    });
    expect(p.secondaryColor).toBe('#111513');
    expect(p.accentColor).toBe('#ABCDEF');
    expect(p.fontHeading).toBe('Bricolage Grotesque');
    expect(p.fontBody).toBe('Lora');
    expect(p.pillars).toHaveLength(8);
    expect(p.pillars[0]).toBe('Kvas');
    expect(p.website).toBeNull();
    expect(p.logoUrl).toBeNull();
    const ok = normalizeProfile({ ...defaultProfile(), website: 'https://pekarna.example', logoUrl: 'data:image/png;base64,AAAA' });
    expect(ok.website).toBe('https://pekarna.example');
    expect(ok.logoUrl).toBe('data:image/png;base64,AAAA');
  });

  it('starý profil bez polí brand kitu dostane výchozí hodnoty; update je zachová', async () => {
    const { s, owner, brand } = await setup();
    const legacy = { tone: 'x', audience: '', bannedWords: [], examples: [], defaultHashtags: [], maxHashtags: 3, languages: ['cs'], emoji: 'few', color: '#000000' };
    const p = normalizeProfile({ ...defaultProfile(), ...(legacy as unknown as BrandProfile) });
    expect(p).toMatchObject({ color: '#000000', secondaryColor: '#111513', fontHeading: 'Bricolage Grotesque', pillars: [], website: null, logoUrl: null });
    const b = await s.catalog.updateBrand(owner, brand.id, { profile: { fontHeading: 'Fraunces', accentColor: '#f5c26b' } });
    expect(b.profile).toMatchObject({ fontHeading: 'Fraunces', accentColor: '#f5c26b', pillars: ['Kvas', 'Lidé'], bannedWords: ['nejlevnější'] });
  });
});

describe('Post.design', () => {
  it('createPost uloží validovaný návrh; neplatný odmítne', async () => {
    const { s, owner, brand } = await setup();
    const p = await s.content.createPost(owner, { brandId: brand.id, body: 'x', networks: ['instagram'], design: { ...image, slides: [{ headline: '  Žitný chléb  ' }] } });
    expect(p.design).toMatchObject({ format: 'image', slides: [{ headline: 'Žitný chléb' }] });
    expect((await s.content.createPost(owner, { brandId: brand.id, body: 'x', networks: ['instagram'] })).design).toBeNull();
    await expect(s.content.createPost(owner, { brandId: brand.id, body: 'x', networks: ['instagram'], design: { ...image, format: 'reel' } })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('změna návrhu = nová verze a zrušení schválení, stejně jako změna textu', async () => {
    const { s, owner, brand, clientActor } = await setup();
    const p = await s.content.createPost(owner, { brandId: brand.id, body: 'Rohlíky', networks: ['instagram'], design: image });
    const { approval } = await s.content.submitForApproval(owner, p.id);
    await s.content.decide(clientActor, p.id, 'approved');
    // stejný návrh znovu = žádná změna obsahu
    const same = await s.content.updatePost(owner, p.id, { design: image });
    expect(same).toMatchObject({ status: 'approved', version: 1 });
    const edited = await s.content.updatePost(owner, p.id, { design: { ...image, templateId: 'bold' } });
    expect(edited).toMatchObject({ status: 'draft', version: 2 });
    expect(edited.design?.templateId).toBe('bold');
    const view = await s.content.getPublicApproval(approval!.token);
    expect(view.isCurrent).toBe(false);
    // odebrání návrhu je také změna obsahu
    const removed = await s.content.updatePost(owner, p.id, { design: null });
    expect(removed).toMatchObject({ design: null, version: 3 });
  });
});

describe('ai.concepts', () => {
  it('vrátí koncepty s kontrolou značky pro každý popisek', async () => {
    const { s, owner, brand } = await setup();
    const cs = await s.ai.concepts(owner, { brandId: brand.id, brief: BRIEF, format: 'carousel', networks: ['instagram', 'facebook'] });
    expect(cs).toHaveLength(3);
    for (const c of cs) {
      expect(c.design.format).toBe('carousel');
      expect(c.issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(c.issues.every((i) => i.network === 'instagram' || i.network === 'facebook')).toBe(true);
      expect(c.hashtags).toEqual(['#pekarna']);
    }
    expect(await s.ai.concepts(owner, { brandId: brand.id, brief: BRIEF, format: 'reel', networks: [], count: 99 })).toHaveLength(
      (await new TemplateAssistant().concepts({ brand, clientName: '', brief: BRIEF, format: 'reel', networks: ['facebook', 'instagram'], language: 'cs', count: 6 })).length,
    );
    // bez sítí použije připojené účty značky
    const [d] = await s.ai.concepts(owner, { brandId: brand.id, brief: BRIEF, format: 'image', networks: [], count: 1 });
    expect(Object.keys(d!.captions).sort()).toEqual(['facebook', 'instagram']);
  });

  it('validuje vstup, klient nesmí, cizí agentura značku nenajde', async () => {
    const { s, owner, brand, clientActor, intruder } = await setup();
    // Popisek, který poruší pravidla značky, dostane chybu se sítí
    const tooMany = await s.ai.concepts(owner, { brandId: brand.id, brief: 'Nejlevnější rohlíky. Pečeme každé ráno.', format: 'image', networks: ['instagram'], count: 1 });
    expect(tooMany[0]!.issues.filter((i) => i.code === 'banned_word')).toEqual([]); // šablona zakázané slovo vynechá
    await expect(s.ai.concepts(owner, { brandId: brand.id, brief: '', format: 'image', networks: ['instagram'] })).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.ai.concepts(owner, { brandId: brand.id, brief: 'x', format: 'gif' as never, networks: ['instagram'] })).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.ai.concepts(clientActor, { brandId: brand.id, brief: BRIEF, format: 'image', networks: ['instagram'] })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(s.ai.concepts(intruder, { brandId: brand.id, brief: BRIEF, format: 'image', networks: ['instagram'] })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('nevalidní výstup asistenta se zahodí (pojistka i pro cizí implementace)', async () => {
    const bad = new TemplateAssistant();
    bad.concepts = async (r: ConceptsRequest) => {
      const good = await new TemplateAssistant().concepts(r);
      return [{ ...good[0]!, design: { ...good[0]!.design, slides: [] } }, good[1]!] as Concept[];
    };
    const s = createServices({
      store: new MemoryStore(), clock: new TestClock().now, newId: () => crypto.randomUUID(), newToken: () => crypto.randomUUID(),
      assistant: bad, publisher: new SimulatedPublisher(), metrics: new SimulatedMetrics(),
    });
    const { agency, user } = await s.tenancy.registerAgency({ agencyName: 'A', ownerEmail: 'a@a.cz', ownerName: 'A' });
    const owner = await s.tenancy.resolveActor(user.id, agency.id);
    const c = await s.catalog.createClient(owner, { name: 'K' });
    const b = await s.catalog.createBrand(owner, { clientId: c.id, name: 'B' });
    const cs = await s.ai.concepts(owner, { brandId: b.id, brief: BRIEF, format: 'carousel', networks: ['instagram'] });
    expect(cs).toHaveLength(1);
  });
});

describe('ai.planMonth', () => {
  it('vrátí plán s termíny v budoucnosti a pilíři značky', async () => {
    const { s, owner, brand } = await setup(); // hodiny: 2. 11. 2026 9:00 UTC
    const items = await s.ai.planMonth(owner, { brandId: brand.id, month: '2026-11', postsPerWeek: 3, networks: ['instagram'] });
    expect(items.length).toBeGreaterThan(8);
    expect(items.every((i) => i.date > '2026-11-02T09:00:00.000Z' && i.date < '2026-12-01')).toBe(true);
    expect(new Set(items.map((i) => i.pillar))).toEqual(new Set(['Kvas', 'Lidé']));
    const reels = await s.ai.planMonth(owner, { brandId: brand.id, month: '2026-12', postsPerWeek: 2, networks: ['instagram'], formats: ['reel'] });
    expect(reels.every((i) => i.format === 'reel')).toBe(true);
  });

  it('validuje měsíc, počet a formáty; klient nesmí; cizí agentura nenajde', async () => {
    const { s, owner, brand, clientActor, intruder } = await setup();
    const base = { brandId: brand.id, month: '2026-12', postsPerWeek: 3, networks: ['instagram' as const] };
    await expect(s.ai.planMonth(owner, { ...base, month: '2026-13' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.ai.planMonth(owner, { ...base, postsPerWeek: 1 })).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.ai.planMonth(owner, { ...base, postsPerWeek: 8 })).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.ai.planMonth(owner, { ...base, formats: ['gif' as never] })).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.ai.planMonth(clientActor, base)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(s.ai.planMonth(intruder, base)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('content.createFromConcept', () => {
  it('vytvoří koncept postu: návrh, body = první popisek, overrides, titulek = háček', async () => {
    const { s, owner, brand } = await setup();
    const [c] = await s.ai.concepts(owner, { brandId: brand.id, brief: BRIEF, format: 'carousel', networks: ['instagram', 'facebook'], count: 1 });
    const p = await s.content.createFromConcept(owner, { brandId: brand.id, concept: c!, scheduledAt: '2026-11-20T08:00:00Z' });
    expect(p).toMatchObject({ status: 'draft', aiAssisted: true, networks: ['instagram', 'facebook'], scheduledAt: '2026-11-20T08:00:00.000Z' });
    expect(p.body).toBe(c!.captions.instagram);
    expect(p.overrides).toEqual({ facebook: c!.captions.facebook });
    expect(p.design).toEqual(c!.design);
    expect(c!.hook.startsWith(p.title)).toBe(true);
    expect(p.title.length).toBeLessThanOrEqual(120);
    const d = await s.content.getPost(owner, p.id);
    expect(d.issues.filter((i) => i.severity === 'error')).toEqual([]);
    await s.content.submitForApproval(owner, p.id); // projde kontrolou značky
  });

  it('odmítne koncept bez popisků nebo s neplatným návrhem; klient nesmí; cizí agentura nenajde', async () => {
    const { s, owner, brand, clientActor, intruder } = await setup();
    const [c] = await s.ai.concepts(owner, { brandId: brand.id, brief: BRIEF, format: 'image', networks: ['instagram'], count: 1 });
    await expect(s.content.createFromConcept(owner, { brandId: brand.id, concept: { ...c!, captions: {} } })).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.content.createFromConcept(owner, { brandId: brand.id, concept: { ...c!, design: { ...c!.design, templateId: 'x' as never } } })).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.content.createFromConcept(clientActor, { brandId: brand.id, concept: c! })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(s.content.createFromConcept(intruder, { brandId: brand.id, concept: c! })).rejects.toMatchObject({ code: 'not_found' });
    expect(await s.content.listPosts(intruder)).toEqual([]);
  });
});

describe('content.bulkCreateFromPlan', () => {
  it('z plánu vytvoří koncepty s návrhem v termínech plánu', async () => {
    const { s, owner, brand } = await setup();
    const plan = await s.ai.planMonth(owner, { brandId: brand.id, month: '2026-12', postsPerWeek: 2, networks: ['instagram'] });
    const posts = await s.content.bulkCreateFromPlan(owner, { brandId: brand.id, items: plan });
    expect(posts).toHaveLength(plan.length);
    posts.forEach((p, i) => {
      expect(p).toMatchObject({ status: 'draft', aiAssisted: true, scheduledAt: plan[i]!.date, title: plan[i]!.idea });
      expect(p.design?.format).toBe(plan[i]!.format);
      expect(p.body.length).toBeGreaterThan(10);
      expect(p.networks).toEqual(['facebook', 'instagram']); // připojené účty značky
    });
    expect((await s.content.listPosts(owner, { brandId: brand.id })).length).toBe(plan.length);
  });

  it('max 31 položek; chyba v jedné položce nevytvoří nic (jedna transakce)', async () => {
    const { s, owner, brand } = await setup();
    const item = { date: '2026-12-01T08:00:00Z', idea: 'Kvas: jak poznat poctivý chléb', format: 'image' as const };
    await expect(s.content.bulkCreateFromPlan(owner, { brandId: brand.id, items: Array.from({ length: 32 }, () => item) })).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.content.bulkCreateFromPlan(owner, { brandId: brand.id, items: [] })).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.content.bulkCreateFromPlan(owner, { brandId: brand.id, items: [item, { ...item, format: 'gif' as never }] })).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.content.bulkCreateFromPlan(owner, { brandId: brand.id, items: [item, { ...item, date: 'nikdy' }] })).rejects.toMatchObject({ code: 'invalid' });
    expect(await s.content.listPosts(owner)).toEqual([]);
    const ok = await s.content.bulkCreateFromPlan(owner, { brandId: brand.id, items: Array.from({ length: 31 }, () => item), networks: ['instagram'] });
    expect(ok).toHaveLength(31);
  });

  it('klient nesmí; cizí agentura značku nenajde', async () => {
    const { s, brand, clientActor, intruder } = await setup();
    const items = [{ date: '2026-12-01T08:00:00Z', idea: 'Nápad', format: 'image' as const }];
    await expect(s.content.bulkCreateFromPlan(clientActor, { brandId: brand.id, items })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(s.content.bulkCreateFromPlan(intruder, { brandId: brand.id, items })).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('RPC allowlist', () => {
  it('nové metody jsou volatelné přes invoke', async () => {
    for (const m of ['ai.concepts', 'ai.planMonth', 'content.createFromConcept', 'content.bulkCreateFromPlan']) expect(isActorMethod(m)).toBe(true);
    const { s, owner, brand, clientActor } = await setup();
    const r = (await invoke(s, owner, 'ai.concepts', [{ brandId: brand.id, brief: BRIEF, format: 'image', networks: ['instagram'], count: 2 }])) as unknown[];
    expect(r).toHaveLength(2);
    await expect(invoke(s, clientActor, 'ai.planMonth', [{ brandId: brand.id, month: '2026-12', postsPerWeek: 3, networks: [] }])).rejects.toMatchObject({ code: 'forbidden' });
  });
});
