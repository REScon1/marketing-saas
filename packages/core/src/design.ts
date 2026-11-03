import { invalid } from './errors.js';
import type { AspectRatio, DesignSlide, DesignSpec, PostFormat, TemplateId } from './types.js';
import { POST_FORMATS, TEMPLATE_IDS } from './types.js';

// Validace návrhu vizuálu (Post.design). Sdílí ji služby i AI adaptéry: co neprojde,
// nesmí se uložit ani vrátit klientovi.

export const DESIGN_LIMITS = {
  headline: 90,
  body: 220,
  kicker: 30,
  cta: 40,
  music: 100,
  /** Jeden obrázek (data URI) – stejně jako u Post.media. */
  mediaUrl: 1_500_000,
  /** Součet všech médií v návrhu. Musí se vejít do limitu těla requestu (6 MB) i s postem okolo. */
  mediaTotal: 4_500_000,
  durationMin: 6,
  durationMax: 60,
} as const;

export const SLIDE_RANGE: Record<PostFormat, { min: number; max: number }> = {
  image: { min: 1, max: 1 },
  carousel: { min: 2, max: 10 },
  reel: { min: 1, max: 8 },
  story: { min: 1, max: 8 },
};

export const ASPECTS_FOR: Record<PostFormat, readonly AspectRatio[]> = {
  image: ['1:1', '4:5'],
  carousel: ['1:1', '4:5'],
  reel: ['9:16'],
  story: ['9:16'],
};

export const isVideoFormat = (f: PostFormat) => f === 'reel' || f === 'story';

const MEDIA_URL_RE = /^data:image\/(png|jpeg|webp|gif|svg\+xml)[;,]/;

/** Stejné pravidlo jako u Post.media: data:image (nahrání) nebo https URL z úložiště. */
export function isAllowedMediaUrl(url: string): boolean {
  return MEDIA_URL_RE.test(url) || /^https:\/\//.test(url);
}

/** Ořízne text na max znaků (po celých znacích, ne UTF-16 jednotkách). */
function clip(v: unknown, max: number): string {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  const chars = [...s];
  return chars.length > max ? chars.slice(0, max).join('').trimEnd() : s;
}

/**
 * Zvaliduje a znormalizuje návrh. Strukturální chyby (formát, poměr stran, šablona, počet slidů,
 * médium) vyhodí `invalid`; texty se oříznou na limity, délka videa se srovná do 6–60 s.
 * Výstup obsahuje jen známá pole (bez undefined), aby se v JSONB ukládal stejně, jak se vrací.
 */
export function validDesign(v: unknown): DesignSpec {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalid('Návrh vizuálu musí být objekt', { field: 'design' });
  const d = v as Record<string, unknown>;
  const format = d.format as PostFormat;
  if (!POST_FORMATS.includes(format)) throw invalid('Neznámý formát návrhu', { field: 'design.format' });

  const aspects = ASPECTS_FOR[format];
  const aspect = (d.aspect === undefined || d.aspect === null ? (isVideoFormat(format) ? '9:16' : '4:5') : d.aspect) as AspectRatio;
  if (!aspects.includes(aspect)) {
    throw invalid(`Formát ${format} podporuje poměr stran ${aspects.join(' nebo ')}`, { field: 'design.aspect' });
  }

  const templateId = d.templateId as TemplateId;
  if (!TEMPLATE_IDS.includes(templateId)) throw invalid('Neznámá šablona návrhu', { field: 'design.templateId' });

  if (!Array.isArray(d.slides)) throw invalid('Návrh musí mít seznam slidů', { field: 'design.slides' });
  const range = SLIDE_RANGE[format];
  if (d.slides.length < range.min || d.slides.length > range.max) {
    const what = isVideoFormat(format) ? 'scén' : 'slidů';
    const msg = range.min === range.max ? `Formát ${format} má právě ${range.min} slide` : `Formát ${format} má ${range.min}–${range.max} ${what}`;
    throw invalid(msg, { field: 'design.slides' });
  }

  let mediaTotal = 0;
  const slides: DesignSlide[] = d.slides.map((raw, i) => {
    if (!raw || typeof raw !== 'object') throw invalid(`Slide ${i + 1} není objekt`, { field: 'design.slides' });
    const s = raw as Record<string, unknown>;
    if (s.headline !== undefined && typeof s.headline !== 'string') {
      throw invalid(`Slide ${i + 1}: titulek musí být text`, { field: 'design.slides' });
    }
    const out: DesignSlide = { headline: clip(s.headline, DESIGN_LIMITS.headline) };
    const kicker = clip(s.kicker, DESIGN_LIMITS.kicker);
    if (kicker) out.kicker = kicker;
    const body = clip(s.body, DESIGN_LIMITS.body);
    if (body) out.body = body;
    if (s.mediaUrl !== undefined && s.mediaUrl !== null && s.mediaUrl !== '') {
      const url = String(s.mediaUrl);
      if (!isAllowedMediaUrl(url)) throw invalid('Nepodporovaný formát obrázku ve slidu', { field: 'design.slides' });
      if (url.length > DESIGN_LIMITS.mediaUrl) throw invalid('Obrázek ve slidu je příliš velký (max. asi 1 MB)', { field: 'design.slides' });
      mediaTotal += url.length;
      out.mediaUrl = url;
    } else if (s.mediaUrl === null) {
      out.mediaUrl = null;
    }
    return out;
  });
  if (mediaTotal > DESIGN_LIMITS.mediaTotal) {
    throw invalid('Obrázky v návrhu jsou dohromady příliš velké (max. asi 4,5 MB)', { field: 'design.slides' });
  }

  const out: DesignSpec = { format, templateId, aspect, slides, seed: toSeed(d.seed) };
  const cta = clip(d.cta, DESIGN_LIMITS.cta);
  if (cta) out.cta = cta;
  if (isVideoFormat(format)) {
    const n = Number(d.durationSec);
    const fallback = slides.length * 3;
    const dur = Number.isFinite(n) && d.durationSec !== null && d.durationSec !== '' ? n : fallback;
    out.durationSec = Math.min(Math.max(Math.round(dur), DESIGN_LIMITS.durationMin), DESIGN_LIMITS.durationMax);
  }
  out.music = typeof d.music === 'string' && d.music.trim() ? clip(d.music, DESIGN_LIMITS.music) : null;
  return out;
}

/** Celé číslo v rozsahu int32 (stabilní přes JSON i JSONB). */
function toSeed(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n) | 0;
}

/** Deterministický hash řetězce na nezáporné int32 (seed pro variabilitu pozadí). */
export function seedFrom(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 2147483647;
}
