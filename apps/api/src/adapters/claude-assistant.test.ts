import type Anthropic from '@anthropic-ai/sdk';
import { defaultProfile } from '@ms/core';
import { describe, expect, it } from 'vitest';
import { planSlots, templatePlan } from '@ms/core';
import {
  buildSummaryPrompt, ClaudeAssistant, conceptsSchema, parseConcepts, parseDraftVariants, parsePlanIdeas, stripCodeFences, type MessagesClient,
} from './claude-assistant.js';

describe('parseDraftVariants', () => {
  it('čistý JSON', () => {
    expect(parseDraftVariants('{"variants":[{"angle":"A","body":"Text 1"},{"angle":"B","body":"Text 2"}]}')).toEqual([
      { angle: 'A', body: 'Text 1' },
      { angle: 'B', body: 'Text 2' },
    ]);
  });

  it('code fence a text okolo', () => {
    expect(parseDraftVariants('```json\n{"variants":[{"angle":"A","body":"X"}]}\n```')).toEqual([{ angle: 'A', body: 'X' }]);
    expect(parseDraftVariants('Tady jsou varianty:\n{"variants":[{"angle":"A","body":"X"}]}\nDoufám, že pomůžou.')).toEqual([{ angle: 'A', body: 'X' }]);
  });

  it('holé pole, chybějící úhel, prázdné varianty přeskočí, ořízne na max', () => {
    const r = parseDraftVariants('[{"body":"a"},{"angle":"x","body":"  "},{"angle":"y","body":"b"},{"body":"c"}]', 2);
    expect(r).toEqual([{ angle: 'Varianta', body: 'a' }, { angle: 'y', body: 'b' }]);
  });

  it('nevalidní odpověď -> DomainError invalid s českou zprávou', () => {
    for (const bad of ['', 'nejde to', '{"variants":"x"}', '{"variants":[{"angle":"a"}]}', '{"foo":1']) {
      try {
        parseDraftVariants(bad);
        expect.unreachable();
      } catch (e) {
        expect(e).toMatchObject({ name: 'DomainError', code: 'invalid' });
        expect((e as Error).message).toMatch(/neočekávaném formátu/);
      }
    }
  });

  it('stripCodeFences', () => {
    expect(stripCodeFences('```\nahoj\n```')).toBe('ahoj');
    expect(stripCodeFences('bez obalu')).toBe('bez obalu');
  });
});

describe('ClaudeAssistant (bez sítě, podvržený klient)', () => {
  const brand = {
    id: 'b', agencyId: 'a', clientId: 'c', name: 'Pekárna', requiresClientApproval: true, archived: false, createdAt: '2026-01-01T00:00:00.000Z',
    profile: { ...defaultProfile(), tone: 'vřelý', audience: 'rodiny', color: '#000000' },
  };
  const fake = (text: string): MessagesClient & { calls: Anthropic.MessageCreateParamsNonStreaming[] } => {
    const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
    return {
      calls,
      messages: {
        create: async (p) => {
          calls.push(p);
          return { content: [{ type: 'text', text, citations: null }] } as unknown as Anthropic.Message;
        },
      },
    };
  };

  it('draft použije prompt z core a model z konfigurace', async () => {
    const client = fake('```json\n{"variants":[{"angle":"A","body":"Čerstvý chléb"}]}\n```');
    const a = new ClaudeAssistant({ model: 'claude-sonnet-5-5', client });
    const v = await a.draft({ brand, clientName: 'Pekárna', brief: 'chléb', networks: ['facebook'], language: 'cs', variants: 3 });
    expect(v).toEqual([{ angle: 'A', body: 'Čerstvý chléb' }]);
    expect(client.calls[0]).toMatchObject({ model: 'claude-sonnet-5-5' });
    expect(String(client.calls[0]!.messages[0]!.content)).toContain('<brief>');
  });

  it('shrnutí reportu předá jen čísla z podkladů a zakáže vymýšlení', () => {
    const p = buildSummaryPrompt(
      { brandName: 'X', periodLabel: 'říjen 2026', posts: 3, reach: 1200, engagements: 60, engagementRate: 0.05, previous: null, topPostTitle: 'T', bestNetwork: 'Facebook' },
      'cs',
    );
    expect(p.system).toMatch(/nevymýšlej/i);
    expect(p.user).toContain('Dosah: 1200');
    expect(p.user).toContain('5,0 %');
  });
});

describe('ClaudeAssistant: koncepty a plán (bez sítě)', () => {
  const brand = {
    id: 'b', agencyId: 'a', clientId: 'c', name: 'Pekárna', requiresClientApproval: true, archived: false, createdAt: '2026-01-01T00:00:00.000Z',
    profile: { ...defaultProfile(), tone: 'vřelý, tykáme', bannedWords: ['nejlevnější'], maxHashtags: 2, pillars: ['Kvas', 'Lidé'] },
  };
  const fake = (text: string, stop: string = 'end_turn'): MessagesClient & { calls: Anthropic.MessageCreateParamsNonStreaming[] } => {
    const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
    return {
      calls,
      messages: {
        create: async (p) => {
          calls.push(p);
          return { content: [{ type: 'text', text, citations: null }], stop_reason: stop } as unknown as Anthropic.Message;
        },
      },
    };
  };
  const good = {
    angle: 'Tip', hook: 'Jak poznat poctivý kvas? Tři znaky.', templateId: 'list', why: 'Užitečné.',
    slides: [{ kicker: 'TIP', headline: 'Jak poznat poctivý kvas?' }, { headline: 'Kůrka praská' }, { headline: 'Uložte si to' }],
    cta: 'Ulož si to', captions: { instagram: 'IG text', facebook: 'FB text' }, hashtags: ['#kvas', '#a', '#b'],
  };
  const req = { brand, clientName: 'Pekárna', brief: 'kvas', format: 'carousel' as const, networks: ['instagram' as const], language: 'cs' as const, count: 3 };

  it('parseConcepts: validuje přes validDesign, zahodí nevalidní, ořízne sítě a hashtagy', () => {
    const bad = { ...good, slides: [{ headline: 'jen jeden' }] };
    const text = '```json\n' + JSON.stringify({ concepts: [bad, good, { foo: 1 }] }) + '\n```';
    const out = parseConcepts(text, req);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ angle: 'Tip', captions: { instagram: 'IG text' }, hashtags: ['#kvas', '#a'] });
    expect(out[0]!.captions).not.toHaveProperty('facebook');
    expect(out[0]!.design).toMatchObject({ format: 'carousel', aspect: '4:5', templateId: 'list' });
    expect(out[0]!.hookScore).toBeGreaterThan(0);
    for (const t of ['nic', '{"concepts":[]}', JSON.stringify({ concepts: [bad] })]) {
      expect(() => parseConcepts(t, req)).toThrow(/neočekávaném formátu/);
    }
  });

  it('concepts: prompt z core + JSON schéma (structured outputs) se sítěmi', async () => {
    const client = fake(JSON.stringify({ concepts: [good] }));
    const a = new ClaudeAssistant({ model: 'claude-sonnet-5-5', client });
    const out = await a.concepts(req);
    expect(out).toHaveLength(1);
    const call = client.calls[0]! as Anthropic.MessageCreateParamsNonStreaming & { output_config?: { format?: { schema: Record<string, unknown> } } };
    expect(call.model).toBe('claude-sonnet-5-5');
    expect(String(call.messages[0]!.content)).toContain('<brief>\nkvas\n</brief>');
    expect(JSON.stringify(call.output_config?.format?.schema)).toContain('"required":["instagram"]');
    expect(conceptsSchema(['linkedin', 'facebook']).properties.concepts.items.properties.captions.required).toEqual(['linkedin', 'facebook']);
  });

  it('odmítnutí modelem -> DomainError s českou zprávou', async () => {
    const a = new ClaudeAssistant({ model: 'claude-sonnet-5-5', client: fake('', 'refusal') });
    await expect(a.concepts(req)).rejects.toMatchObject({ code: 'invalid', message: expect.stringMatching(/odmítl/) });
  });

  it('planMonth: termíny počítá kód, model dodá nápady; chybějící doplní šablona', async () => {
    const preq = { brand, month: '2026-12', postsPerWeek: 2, networks: ['instagram' as const], now: '2026-11-03T00:00:00.000Z' };
    const slots = planSlots(preq);
    const client = fake(JSON.stringify({ items: [{ index: 0, idea: 'Kvas: proč chleba potřebuje 18 hodin' }, { index: 99, idea: 'mimo' }, { index: 1, idea: '  ' }] }));
    const a = new ClaudeAssistant({ model: 'claude-sonnet-5-5', client });
    const items = await a.planMonth(preq);
    expect(items).toHaveLength(slots.length);
    expect(items.map((i) => i.date)).toEqual(slots.map((s) => s.date));
    expect(items[0]!.idea).toBe('Kvas: proč chleba potřebuje 18 hodin');
    expect(items[1]!.idea).toBe(templatePlan(preq)[1]!.idea);
    expect(String(client.calls[0]!.messages[0]!.content)).toContain(`0. ${slots[0]!.date}`);
    expect(() => parsePlanIdeas('{"items":[]}', slots, [])).toThrow(/neočekávaném formátu/);
    // měsíc v minulosti: žádné volání modelu
    const empty = fake('{}');
    expect(await new ClaudeAssistant({ model: 'm', client: empty }).planMonth({ ...preq, month: '2026-10' })).toEqual([]);
    expect(empty.calls).toHaveLength(0);
  });
});
