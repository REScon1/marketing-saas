import { describe, expect, it } from 'vitest';
import { DESIGN_LIMITS, validDesign } from './design.js';

const base = { format: 'image', templateId: 'editorial', aspect: '4:5', slides: [{ headline: 'Titulek' }], seed: 1 };

describe('validDesign', () => {
  it('projde platný návrh a vrátí jen známá pole', () => {
    const d = validDesign({ ...base, extra: 'x', slides: [{ headline: '  Titulek  ', kicker: 'NOVINKA', foo: 1 }] });
    expect(d).toEqual({ format: 'image', templateId: 'editorial', aspect: '4:5', slides: [{ headline: 'Titulek', kicker: 'NOVINKA' }], seed: 1, music: null });
    expect('durationSec' in d).toBe(false);
  });

  it('formát, šablona a poměr stran musí sedět', () => {
    for (const bad of [
      { ...base, format: 'gif' },
      { ...base, templateId: 'neon' },
      { ...base, aspect: '9:16' },
      { ...base, format: 'reel', aspect: '4:5' },
      { ...base, format: 'story', aspect: '1:1' },
      null, 'x', [],
    ]) {
      expect(() => validDesign(bad)).toThrow(expect.objectContaining({ code: 'invalid' }));
    }
    expect(validDesign({ ...base, format: 'carousel', aspect: '1:1', slides: [{ headline: 'a' }, { headline: 'b' }] }).aspect).toBe('1:1');
    // chybějící poměr stran: výchozí podle formátu
    expect(validDesign({ ...base, aspect: undefined }).aspect).toBe('4:5');
    expect(validDesign({ ...base, format: 'reel', aspect: undefined }).aspect).toBe('9:16');
  });

  it('počet slidů podle formátu', () => {
    const slides = (n: number) => Array.from({ length: n }, (_, i) => ({ headline: `S${i}` }));
    expect(() => validDesign({ ...base, slides: slides(2) })).toThrow();
    expect(() => validDesign({ ...base, slides: [] })).toThrow();
    expect(() => validDesign({ ...base, format: 'carousel', slides: slides(1) })).toThrow();
    expect(() => validDesign({ ...base, format: 'carousel', slides: slides(11) })).toThrow();
    expect(validDesign({ ...base, format: 'carousel', slides: slides(10) }).slides).toHaveLength(10);
    expect(() => validDesign({ ...base, format: 'reel', aspect: '9:16', slides: slides(9) })).toThrow();
    expect(validDesign({ ...base, format: 'story', aspect: '9:16', slides: slides(1) }).slides).toHaveLength(1);
  });

  it('ořízne texty na limity', () => {
    const long = (n: number) => 'á'.repeat(n);
    const d = validDesign({ ...base, cta: long(60), slides: [{ headline: long(200), body: long(400), kicker: long(50) }] });
    expect([...d.slides[0]!.headline]).toHaveLength(DESIGN_LIMITS.headline);
    expect([...d.slides[0]!.body!]).toHaveLength(DESIGN_LIMITS.body);
    expect([...d.slides[0]!.kicker!]).toHaveLength(DESIGN_LIMITS.kicker);
    expect([...d.cta!]).toHaveLength(DESIGN_LIMITS.cta);
    expect(() => validDesign({ ...base, slides: [{ headline: 42 }] })).toThrow();
  });

  it('média: data:image nebo https, limit velikosti jednoho i součtu', () => {
    expect(validDesign({ ...base, slides: [{ headline: 'a', mediaUrl: 'https://cdn.example/a.jpg' }] }).slides[0]!.mediaUrl).toBe('https://cdn.example/a.jpg');
    expect(validDesign({ ...base, slides: [{ headline: 'a', mediaUrl: 'data:image/png;base64,AAAA' }] }).slides[0]!.mediaUrl).toMatch(/^data:image/);
    expect(validDesign({ ...base, slides: [{ headline: 'a', mediaUrl: null }] }).slides[0]!.mediaUrl).toBeNull();
    for (const url of ['javascript:alert(1)', 'http://x.example/a.jpg', 'data:text/html;base64,AAAA']) {
      expect(() => validDesign({ ...base, slides: [{ headline: 'a', mediaUrl: url }] })).toThrow(expect.objectContaining({ code: 'invalid' }));
    }
    const big = `data:image/jpeg;base64,${'A'.repeat(DESIGN_LIMITS.mediaUrl)}`;
    expect(() => validDesign({ ...base, slides: [{ headline: 'a', mediaUrl: big }] })).toThrow(/příliš velký/);
    const mb = `data:image/jpeg;base64,${'A'.repeat(1_400_000)}`;
    const four = Array.from({ length: 4 }, () => ({ headline: 'a', mediaUrl: mb }));
    expect(() => validDesign({ ...base, format: 'carousel', slides: four })).toThrow(/dohromady/);
  });

  it('délka videa 6–60 s jen u reel/story; seed je celé číslo', () => {
    const reel = { ...base, format: 'reel', aspect: '9:16', slides: [{ headline: 'a' }, { headline: 'b' }] };
    expect(validDesign({ ...reel, durationSec: 2 }).durationSec).toBe(6);
    expect(validDesign({ ...reel, durationSec: 600 }).durationSec).toBe(60);
    expect(validDesign({ ...reel, durationSec: 12.4 }).durationSec).toBe(12);
    expect(validDesign({ ...reel }).durationSec).toBe(6); // 2 scény × 3 s, srovnáno na minimum
    expect(validDesign({ ...base, durationSec: 30 }).durationSec).toBeUndefined();
    expect(validDesign({ ...base, seed: 3.7 }).seed).toBe(3);
    expect(validDesign({ ...base, seed: 'abc' }).seed).toBe(0);
    expect(Number.isInteger(validDesign({ ...base, seed: 1e12 }).seed)).toBe(true);
  });
});
