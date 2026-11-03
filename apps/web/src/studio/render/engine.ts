// Jádro: velikosti, časování videa, vykreslení snímku (včetně přechodů mezi scénami).
import type { AspectRatio, DesignSpec, PostFormat, TemplateId } from '@ms/core';
import { paletteFor, storyProgress } from './paint';
import { DRAW } from './templates';
import type { DrawOptions, Scene } from './types';
import { clamp, easeInOutCubic } from './util';

export const TEMPLATES: { id: TemplateId; label: string; formats: PostFormat[]; description: string }[] = [
  { id: 'editorial', label: 'Magazín', formats: ['image', 'carousel', 'reel', 'story'], description: 'Titulní strana časopisu: tiráž s číslem vydání, dvojitá linka, velký titulek a perex.' },
  { id: 'bold', label: 'Výrazná', formats: ['image', 'carousel', 'reel', 'story'], description: 'Obří titulek v barvě značky a kontrastní akcentní pás. Ideální na akce a nabídky.' },
  { id: 'photo', label: 'Fotka', formats: ['image', 'carousel', 'reel', 'story'], description: 'Fotka přes celou plochu se ztmavením, titulek vlevo dole a logo nahoře.' },
  { id: 'quote', label: 'Citát', formats: ['image', 'carousel', 'reel', 'story'], description: 'Velké uvozovky, citát v nadpisovém písmu, autor a hodně vzduchu. Na reference a recenze.' },
  { id: 'list', label: 'Seznam / kroky', formats: ['image', 'carousel', 'reel', 'story'], description: 'Číslované tipy a kroky s průběhem karuselu. Titulní slide ukáže obsah.' },
  { id: 'minimal', label: 'Minimalistická', formats: ['image', 'carousel', 'reel', 'story'], description: 'Hodně bílého místa, drobná typografie, logo a jemné linky. Decentní a elegantní.' },
  { id: 'split', label: 'Půlená', formats: ['image', 'carousel', 'reel', 'story'], description: 'Fotka na jedné půlce, text na druhé; strany se u karuselu střídají.' },
  { id: 'gradient', label: 'Přechod', formats: ['image', 'carousel', 'reel', 'story'], description: 'Bohatý mesh přechod z barev značky se zrnem a vystředěným titulkem.' },
];

export function sizeFor(aspect: AspectRatio): { w: number; h: number } {
  if (aspect === '9:16') return { w: 1080, h: 1920 };
  if (aspect === '4:5') return { w: 1080, h: 1350 };
  return { w: 1080, h: 1080 };
}

export function isVideo(design: Pick<DesignSpec, 'format'>): boolean {
  return design.format === 'reel' || design.format === 'story';
}

/** Celková délka reel/story v sekundách (durationSec, jinak 3 s na scénu; 6–60 s). */
export function totalDuration(design: DesignSpec): number {
  const n = Math.max(1, design.slides.length);
  return clamp(design.durationSec ?? n * 3, 6, 60);
}

/** Délka jedné scény. */
export function sceneDuration(design: DesignSpec): number {
  return totalDuration(design) / Math.max(1, design.slides.length);
}

/** Která scéna běží v čase t (s) a jak dlouho už. */
export function sceneAt(design: DesignSpec, t: number): { index: number; local: number } {
  const n = Math.max(1, design.slides.length);
  const d = sceneDuration(design);
  const tt = clamp(t, 0, totalDuration(design) - 1e-6);
  const index = Math.min(n - 1, Math.floor(tt / d));
  return { index, local: tt - index * d };
}

export const TRANSITION = 0.45;

function buildScene(ctx: CanvasRenderingContext2D, o: DrawOptions, index: number, local: number | null): Scene {
  const { design, brand, w: W, h: H } = o;
  const video = isVideo(design);
  const n = Math.max(1, design.slides.length);
  const i = clamp(index, 0, n - 1);
  const slide = design.slides[i] ?? { headline: '' };
  const vertical = H / W > 1.5;
  const m = Math.round(W * 0.074);
  const top = vertical ? Math.round(H * (video ? (design.format === 'story' ? 0.15 : 0.13) : 0.08)) : m;
  const right = vertical && video ? Math.round(W * 0.11) : m;
  const bottom = vertical ? Math.round(H * (video ? 0.12 : 0.07)) : m;
  const isLast = i === n - 1;
  const logoUrl = brand.profile.logoUrl;
  return {
    ctx,
    W,
    H,
    P: paletteFor(brand.profile),
    brand,
    design,
    slide,
    i,
    n,
    isLast,
    cta: isLast && design.cta?.trim() ? design.cta.trim() : null,
    img: slide.mediaUrl ? o.images.get(slide.mediaUrl) : undefined,
    logo: logoUrl ? o.images.get(logoUrl) : undefined,
    video,
    local,
    dur: video ? sceneDuration(design) : 3,
    t: video ? o.t : 0,
    box: { x: m, y: top, w: W - m - right, h: H - top - bottom },
    m,
    seed: Math.abs(Math.round(design.seed || 0)),
    fh: brand.profile.fontHeading || 'Onest',
    fb: brand.profile.fontBody || 'Onest',
  };
}

function paint(ctx: CanvasRenderingContext2D, s: Scene) {
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const draw = DRAW[s.design.templateId] ?? DRAW.editorial;
  draw(s);
  ctx.restore();
}

/** Vykreslí jeden snímek návrhu do kontextu (souřadnice w×h, typicky 1080×…). */
export function drawFrame(ctx: CanvasRenderingContext2D, o: DrawOptions): void {
  const { design, w, h } = o;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  if (!isVideo(design)) {
    paint(ctx, buildScene(ctx, o, o.slide, null));
    ctx.restore();
    return;
  }
  const { index, local } = sceneAt(design, o.t);
  const d = sceneDuration(design);
  if (index > 0 && local < TRANSITION) {
    // přechod: předchozí scéna v plném stavu, nová se odkrývá stíračkou s akcentní hranou
    paint(ctx, buildScene(ctx, o, index - 1, d));
    const p = easeInOutCubic(local / TRANSITION);
    const P = paletteFor(o.brand.profile);
    ctx.save();
    ctx.beginPath();
    const horizontal = index % 2 === 1;
    if (horizontal) ctx.rect(0, 0, w * p, h);
    else ctx.rect(0, h * (1 - p), w, h * p);
    ctx.clip();
    paint(ctx, buildScene(ctx, o, index, local));
    ctx.restore();
    ctx.fillStyle = P.accent;
    if (p < 1) {
      if (horizontal) ctx.fillRect(w * p - 6, 0, 12, h);
      else ctx.fillRect(0, h * (1 - p) - 6, w, 12);
    }
  } else {
    paint(ctx, buildScene(ctx, o, index, local));
  }
  if (design.format === 'story' && o.progress !== false) {
    storyProgress(ctx, w, Math.max(1, design.slides.length), index, clamp(local / d), '#ffffff');
  }
  ctx.restore();
}
