import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { buildSummaryPrompt, ClaudeAssistant, parseDraftVariants, stripCodeFences, type MessagesClient } from './claude-assistant.js';

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
    profile: { tone: 'vřelý', audience: 'rodiny', bannedWords: [], examples: [], defaultHashtags: [], maxHashtags: 3, languages: ['cs' as const], emoji: 'few' as const, color: '#000000' },
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
