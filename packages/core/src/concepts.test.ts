import { describe, expect, it } from 'vitest';
import { buildConceptsPrompt, buildPlanPrompt, TemplateAssistant } from './assistant.js';
import {
  coerceConcept, compact, derivePillars, hookScore, planSlots, pragueToIso, scrubBanned, templateConcepts, templatePlan,
  type ConceptsRequest,
} from './concepts.js';
import { validDesign } from './design.js';
import { defaultProfile } from './services.js';
import type { Brand, BrandProfile } from './types.js';

const brandOf = (name: string, p: Partial<BrandProfile>): Brand => ({
  id: `b-${name}`, agencyId: 'a', clientId: 'c', name, requiresClientApproval: true, archived: false, createdAt: '2026-01-01T00:00:00.000Z',
  profile: { ...defaultProfile(), ...p },
});
const pek = brandOf('Pekárna U Lípy', {
  tone: 'Vřelý, rodinný. Tykáme. Krátké věty.', audience: 'Rodiny a lidé z okolí, 25–55 let', defaultHashtags: ['#pekarnaulipy', '#kvas', '#chleba', '#brno'],
  maxHashtags: 2, emoji: 'few', bannedWords: ['nejlevnější'], website: 'https://pekarna-ulipy.example',
});
const nov = brandOf('Novák Stavby', {
  tone: 'Věcný a odborný. Vykáme. Konkrétní čísla místo přívlastků.', audience: 'Investoři, developeři a majitelé domů',
  defaultHashtags: ['#stavebnictvi'], maxHashtags: 2, emoji: 'none', bannedWords: ['super'],
});
const fit = brandOf('FitZóna', { tone: 'Energický, tykáme.', audience: 'Lidé 20–45 let v Brně', defaultHashtags: ['#fitzonabrno'], maxHashtags: 4, emoji: 'many' });

const req = (brand: Brand, brief: string, format: ConceptsRequest['format'], networks: ConceptsRequest['networks'], count = 6): ConceptsRequest =>
  ({ brand, clientName: '', brief, format, networks, language: 'cs', count });

const EMOJI = /\p{Extended_Pictographic}/u;

describe('TemplateAssistant.concepts', () => {
  const breadBrief = 'Novinka: žitný chléb se slunečnicí a lnem. Vydrží měkký i tři dny. Pečeme ho každé ráno od 6:30, bochník za 69 Kč.';

  it('různé úhly, platné návrhy, deterministické', async () => {
    const a = new TemplateAssistant();
    const cs = await a.concepts(req(pek, breadBrief, 'image', ['instagram', 'facebook']));
    expect(cs.length).toBeGreaterThanOrEqual(4);
    expect(new Set(cs.map((c) => c.angle)).size).toBe(cs.length);
    for (const c of cs) {
      expect(validDesign(c.design)).toEqual(c.design);
      expect(c.design.slides).toHaveLength(1);
      expect(c.hook.length).toBeGreaterThan(10);
      expect(c.why).toMatch(/\S/);
      expect(c.hookScore).toBeGreaterThanOrEqual(0);
      expect(c.hookScore).toBeLessThanOrEqual(100);
      expect(Object.keys(c.captions).sort()).toEqual(['facebook', 'instagram']);
    }
    expect(await a.concepts(req(pek, breadBrief, 'image', ['instagram', 'facebook']))).toEqual(cs);
    expect((await a.concepts(req(pek, breadBrief, 'image', ['instagram'], 2)))).toHaveLength(2);
  });

  it('nepoužívá klišé ani vymyšlená fakta z jiných briefů', () => {
    const cs = templateConcepts(req(pek, breadBrief, 'image', ['instagram', 'facebook', 'linkedin']));
    const all = JSON.stringify(cs);
    expect(all).not.toMatch(/Co z toho máte/);
    expect(all).not.toMatch(/Neváhejte/);
    // nabídka je mezi úhly jen proto, že brief obsahuje cenu
    expect(cs.map((c) => c.angle)).toContain('Nabídka');
    const noOffer = templateConcepts(req(nov, 'Dokončili jsme hrubou stavbu bytového domu v Brně-Líšni. 24 bytových jednotek za 7 měsíců.', 'image', ['linkedin']));
    expect(noOffer.map((c) => c.angle)).not.toContain('Nabídka');
  });

  it('popisky podle sítě: IG s hashtagy a odřádkováním, FB s odkazem, LinkedIn odstavce', () => {
    const [c] = templateConcepts(req(pek, breadBrief, 'image', ['instagram', 'facebook', 'linkedin'], 1));
    const ig = c!.captions.instagram!;
    expect(ig.split('\n').length).toBeGreaterThan(3);
    expect(ig.trim().split('\n').at(-1)).toBe('#pekarnaulipy #kvas'); // maxHashtags = 2
    expect(c!.hashtags).toEqual(['#pekarnaulipy', '#kvas']);
    expect(c!.captions.facebook).toContain('https://pekarna-ulipy.example');
    const li = c!.captions.linkedin!.split('\n\n');
    expect(li.length).toBeGreaterThanOrEqual(3);
    // tykání podle tónu značky
    expect(ig).toMatch(/Zastav se|Napiš|Ulož|Přijď|Pošli/);
  });

  it('bez webu dá do Facebooku zástupný odkaz; emoji „none“ = žádné emoji, vykání', () => {
    const cs = templateConcepts(req(nov, 'Dokončili jsme hrubou stavbu bytového domu v Brně-Líšni. 24 bytových jednotek za 7 měsíců. Bez skluzu harmonogramu.', 'reel', ['linkedin', 'facebook']));
    for (const c of cs) {
      expect(c.captions.facebook).toContain('[odkaz]');
      expect(EMOJI.test(c.captions.linkedin!)).toBe(false);
      expect(EMOJI.test(c.captions.facebook!)).toBe(false);
      expect(c.captions.linkedin).not.toMatch(/(?<![\p{L}])(napiš|ulož|zastav se)(?![\p{L}])/iu);
    }
  });

  it('zakázaná slova se do textu nedostanou, ani když jsou v briefu', () => {
    const cs = templateConcepts(req(pek, 'Nejlevnější rohlíky ve městě. Pečeme je každé ráno od 6:00.', 'image', ['instagram', 'facebook']));
    for (const c of cs) expect(JSON.stringify(c).toLowerCase()).not.toContain('nejlevnější');
  });

  it('karusel: titulní slide → číslované body z briefu → CTA slide', () => {
    const brief = 'Jak začít s posilováním: přijď na úvodní konzultaci s trenérem, začni se dvěma tréninky týdně, nauč se techniku dřepu s vlastní vahou, váhu přidávej až po třech týdnech.';
    const cs = templateConcepts(req(fit, brief, 'carousel', ['instagram']));
    const tip = cs.find((c) => c.angle === 'Tip')!;
    expect(cs[0]!.angle).toBe('Tip');
    expect(tip.design.templateId).toBe('list');
    const s = tip.design.slides;
    expect(s[0]).toMatchObject({ headline: 'Jak začít s posilováním?' });
    expect(s.slice(1, -1).map((x) => x.kicker)).toEqual(['KROK 1', 'KROK 2', 'KROK 3', 'KROK 4']);
    expect(s[1]!.headline).toBe('Přijď na úvodní konzultaci s trenérem');
    expect(s.at(-1)!.kicker).toBe('A TEĎ TY');
    expect(tip.hook).toBe('Jak začít s posilováním? Ve 4 krocích.');
    expect(tip.captions.instagram).toContain('→ Začni se dvěma tréninky týdně');
  });

  it('karusel z pouhého titulku: kostra s výzvou k doplnění, nic nevymýšlí', () => {
    const cs = templateConcepts(req(pek, 'Kvas a řemeslo: 5 nejčastějších chyb a jak se jim vyhnout', 'carousel', ['instagram'], 3));
    const tip = cs.find((c) => c.angle === 'Tip')!;
    expect(tip.design.slides.slice(1, -1).map((x) => x.kicker)).toEqual(['CHYBA 1', 'CHYBA 2', 'CHYBA 3', 'CHYBA 4', 'CHYBA 5']);
    expect(tip.design.slides[1]!.headline).toMatch(/\[doplňte/);
    expect(cs.map((c) => c.angle)).not.toContain('Sociální důkaz');
  });

  it('reel: 3–5 scén, krátký text na obrazovce, délka 2–4 s na scénu', () => {
    const cs = templateConcepts(req(pek, 'V sobotu od 10:00 zdobíme perníčky s dětmi přímo v pekárně. Zástěry půjčíme. Poleva je na nás.', 'reel', ['instagram']));
    for (const c of cs) {
      const n = c.design.slides.length;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
      expect(c.design.aspect).toBe('9:16');
      expect(c.design.durationSec! / n).toBeGreaterThanOrEqual(2);
      expect(c.design.durationSec! / n).toBeLessThanOrEqual(4);
      for (const s of c.design.slides) expect([...s.headline].length).toBeLessThanOrEqual(60);
      expect(c.design.slides.map((s) => s.headline).join(' ')).not.toContain('…');
    }
    expect(cs.find((c) => c.angle === 'Otázka')!.hook).toBe('Co děláš v sobotu?');
  });

  it('šablony podle úhlu a briefu', () => {
    const offer = templateConcepts(req(pek, 'Dýňové koláče jsou u nás jen do neděle. Kus za 35 Kč.', 'image', ['instagram'])).find((c) => c.angle === 'Nabídka')!;
    expect(offer.design.templateId).toBe('bold');
    expect(offer.hook).toMatch(/^Jen do neděle:/);
    const quote = templateConcepts(req(pek, 'Paní Jana nám napsala: „Váš kváskový chleba je jediný, který doma vydrží do neděle.“', 'image', ['instagram'])).find((c) => c.angle === 'Sociální důkaz')!;
    expect(quote.design.templateId).toBe('quote');
    const photo = templateConcepts(req(pek, 'Fotky z dnešního pečení. Kváskový chléb jde z pece každé ráno.', 'image', ['instagram'], 1))[0]!;
    expect(photo.design.templateId).toBe('photo');
  });

  it('LinkedIn-only grafika je čtverec, s Instagramem 4:5', () => {
    expect(templateConcepts(req(nov, 'Hala v Modřicích je pod střechou.', 'image', ['linkedin'], 1))[0]!.design.aspect).toBe('1:1');
    expect(templateConcepts(req(pek, 'Žitný chléb je zpět.', 'image', ['instagram'], 1))[0]!.design.aspect).toBe('4:5');
  });
});

describe('heuristiky a pomůcky', () => {
  it('hookScore: otázka, číslo, oslovení a naléhavost přidají, zakázané slovo ubere', () => {
    const p = { bannedWords: ['super'] };
    expect(hookScore('Víte, proč chleba z kvasu vydrží 3 dny?', p)).toBeGreaterThan(hookScore('Chleba z kvasu.', p));
    expect(hookScore('Jen do neděle: dýňové koláče za 35 Kč', p)).toBeGreaterThan(hookScore('Dýňové koláče', p));
    expect(hookScore('Super nabídka na dýňové koláče pro vás', p)).toBeLessThan(hookScore('Nabídka na dýňové koláče pro vás', p));
    expect(hookScore('', p)).toBeGreaterThanOrEqual(0);
    expect(hookScore('?'.repeat(500), { bannedWords: [] })).toBeLessThanOrEqual(100);
  });

  it('scrubBanned a compact', () => {
    expect(scrubBanned('Nejlevnější rohlíky ve městě.', ['nejlevnější'])).toBe('Rohlíky ve městě.');
    expect(compact('Pro klienta z Modřic stavíme halu v pasivním standardu a s rekuperací', 45)).toBe('Pro klienta z Modřic stavíme halu');
    expect(compact('Co děláš v sobotu?', 45)).toBe('Co děláš v sobotu?');
  });

  it('coerceConcept: validuje návrh, ořízne sítě a hashtagy, přepočítá skóre', () => {
    const raw = {
      angle: 'Tip', hook: 'Víte, jak poznat poctivý kvas?', templateId: 'list', hookScore: 100,
      slides: [{ headline: 'A' }, { headline: 'B' }, { headline: 'C' }], captions: { instagram: 'IG', linkedin: 'LI', tiktok: 'x' },
      hashtags: ['kvas', '#a', '#b'], why: 'Protože.',
    };
    const c = coerceConcept(raw, { brand: pek, format: 'carousel', networks: ['instagram'], brief: 'b' })!;
    expect(c.captions).toEqual({ instagram: 'IG' });
    expect(c.hashtags).toEqual(['#kvas', '#a']);
    expect(c.hookScore).toBe(hookScore(raw.hook, pek.profile));
    expect(c.design).toMatchObject({ format: 'carousel', templateId: 'list', aspect: '4:5' });
    expect(coerceConcept({ ...raw, slides: [{ headline: 'jen jeden' }] }, { brand: pek, format: 'carousel', networks: ['instagram'], brief: 'b' })).toBeNull();
    expect(coerceConcept({ ...raw, captions: {} }, { brand: pek, format: 'carousel', networks: ['instagram'], brief: 'b' })).toBeNull();
    expect(coerceConcept({ ...raw, templateId: 'neon' }, { brand: pek, format: 'carousel', networks: ['instagram'], brief: 'b' })!.design.templateId).toBe('editorial');
  });
});

describe('měsíční plán', () => {
  const now = '2026-11-03T08:00:00.000Z';

  it('Pražský čas → UTC včetně letního času', () => {
    expect(pragueToIso(2026, 11, 4, 7, 30)).toBe('2026-11-04T06:30:00.000Z');
    expect(pragueToIso(2026, 7, 1, 19, 0)).toBe('2026-07-01T17:00:00.000Z');
    expect(pragueToIso(2026, 3, 30, 7, 30)).toBe('2026-03-30T05:30:00.000Z'); // den po přechodu na letní čas
  });

  it('rozloží posty do týdne v rozumných časech a vynechá minulost', () => {
    const slots = planSlots({ brand: pek, month: '2026-11', postsPerWeek: 3, networks: ['instagram'], now });
    expect(slots.every((s) => s.date > now)).toBe(true);
    // listopad 2026 od 4. 11.: Po/St/Pá
    const days = slots.map((s) => new Date(s.date).getUTCDay());
    expect(new Set(days)).toEqual(new Set([1, 3, 5]));
    expect(slots).toHaveLength(12);
    const local = slots.map((s) => new Date(s.date).toLocaleTimeString('cs-CZ', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit' }));
    for (const t of local) expect(['07:30', '11:30', '17:30', '19:00']).toContain(t);
    // celý měsíc v budoucnosti, 7× týdně = každý den
    expect(planSlots({ brand: pek, month: '2026-12', postsPerWeek: 7, networks: ['instagram'], now })).toHaveLength(31);
    expect(planSlots({ brand: pek, month: '2026-10', postsPerWeek: 5, networks: ['instagram'], now })).toEqual([]);
  });

  it('střídá pilíře a mixuje formáty 40/30/30, nebo zadané formáty', () => {
    const items = templatePlan({ brand: brandOf('X', { pillars: ['A', 'B', 'C'] }), month: '2026-12', postsPerWeek: 5, networks: ['instagram'], now });
    expect(items.slice(0, 6).map((i) => i.pillar)).toEqual(['A', 'B', 'C', 'A', 'B', 'C']);
    const count = (f: string) => items.filter((i) => i.format === f).length;
    expect(count('image')).toBeGreaterThan(count('reel'));
    expect(count('carousel')).toBeGreaterThan(0);
    expect(count('reel')).toBeGreaterThan(0);
    const only = templatePlan({ brand: pek, month: '2026-12', postsPerWeek: 2, networks: ['instagram'], formats: ['story', 'carousel'], now });
    expect(new Set(only.map((i) => i.format))).toEqual(new Set(['story', 'carousel']));
  });

  it('každá položka má konkrétní český nápad; bez pilířů je odvodí z tónu', () => {
    const items = templatePlan({ brand: pek, month: '2026-12', postsPerWeek: 4, networks: ['instagram'], now });
    for (const i of items) expect(i.idea).toMatch(new RegExp(`^${i.pillar}: \\S`));
    expect(new Set(items.map((i) => i.idea)).size).toBeGreaterThan(items.length * 0.7);
    expect(items.some((i) => i.idea.includes('v prosinci') || i.idea.includes('na prosinec'))).toBe(true);
    expect(derivePillars(pek.profile)).toHaveLength(4);
    expect(derivePillars(nov.profile)).toContain('Reference a výsledky');
    expect(derivePillars({ ...pek.profile, pillars: ['Jen tohle'] })).toEqual(['Jen tohle']);
  });
});

describe('prompty pro LLM', () => {
  it('buildConceptsPrompt: brand kontext, formát, sítě a JSON kontrakt', () => {
    const p = buildConceptsPrompt(req(nov, 'Hala v Modřicích', 'carousel', ['linkedin', 'facebook'], 3));
    expect(p.system).toMatch(/Nevymýšlíš fakta/);
    expect(p.user).toContain('<brief>\nHala v Modřicích\n</brief>');
    expect(p.user).toContain('Navrhni 3 odlišné koncepty');
    expect(p.user).toMatch(/Karusel: 4–7 slidů/);
    expect(p.user).toContain('LinkedIn, Facebook');
    expect(p.user).toContain('Nikdy nepoužívej: super');
    expect(p.user).toContain('[odkaz]');
    expect(p.user).toContain('{"concepts":[');
    expect(buildConceptsPrompt(req(pek, 'x', 'reel', ['instagram'])).user).toMatch(/3–5 scén po 2–4 sekundách/);
  });

  it('buildPlanPrompt: rozvrh s indexy a pilíři, JSON kontrakt', () => {
    const r = { brand: pek, month: '2026-12', postsPerWeek: 2, networks: ['instagram' as const], now: '2026-11-03T00:00:00.000Z' };
    const slots = planSlots(r);
    const p = buildPlanPrompt(r, slots);
    expect(p.user).toContain(`0. ${slots[0]!.date} | ${slots[0]!.pillar} | ${slots[0]!.format}`);
    expect(p.user).toContain(`${slots.length - 1}. `);
    expect(p.user).toContain('{"items":[{"index":0,"idea":"…"}]}');
    expect(p.user).toContain('Pilíře obsahu:');
  });
});
