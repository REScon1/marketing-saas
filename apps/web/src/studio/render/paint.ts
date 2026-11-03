// Malířské primitivy: paleta ze značky, mesh gradienty, zrno, fotky (cover, duotón, Ken Burns), logo/monogram,
// navigace karuselu, CTA tlačítko, progress story.
import type { BrandProfile } from '@ms/core';
import { font } from './fonts';
import { layoutText, drawLayout, roundRect, setFont, measure, type TextStyle } from './text';
import { bestOn, ensureContrast, hexToRgb, initials, luminance, mix, rgba, rng } from './util';

export interface Palette {
  primary: string;
  secondary: string;
  accent: string;
  /** Světlý „papír“ lehce tónovaný barvou značky. */
  paper: string;
  /** Tmavá barva textu. */
  ink: string;
  inkSoft: string;
  /** Sytá tmavá plocha (sekundární barva / tmavá varianta primární). */
  deep: string;
  onPrimary: string;
  onAccent: string;
  onDeep: string;
  /** Primární barva čitelná na papíře. */
  primaryOnPaper: string;
  /** Akcent čitelný na tmavé ploše. */
  accentOnDeep: string;
  /** Akcent čitelný na primární ploše (nebo onPrimary). */
  accentOnPrimary: string;
}

const cache = new Map<string, Palette>();

export function paletteFor(p: Pick<BrandProfile, 'color' | 'secondaryColor' | 'accentColor'>): Palette {
  const key = `${p.color}|${p.secondaryColor}|${p.accentColor}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const primary = p.color || '#1f2937';
  const secondary = p.secondaryColor || mix(primary, '#000000', 0.7);
  const accent = p.accentColor || mix(primary, '#ffffff', 0.55);
  const paper = mix('#f7f4ee', primary, 0.045);
  const ink = luminance(secondary) < 0.06 ? mix(secondary, '#0a0a0a', 0.25) : mix(primary, '#0b0b0b', 0.86);
  const deep = luminance(secondary) < 0.08 ? secondary : mix(primary, '#060606', 0.72);
  const onPrimary = bestOn(primary, '#ffffff', ink);
  const pal: Palette = {
    primary,
    secondary,
    accent,
    paper,
    ink,
    inkSoft: mix(ink, paper, 0.32),
    deep,
    onPrimary,
    onAccent: bestOn(accent, ink, '#ffffff'),
    onDeep: '#ffffff',
    primaryOnPaper: ensureContrast(primary, paper, 3.2),
    accentOnDeep: ensureContrast(accent, deep, 3),
    accentOnPrimary: contrastOk(accent, primary, 2.2) ? accent : onPrimary,
  };
  cache.set(key, pal);
  return pal;
}

function contrastOk(a: string, b: string, min: number) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05) >= min;
}

// ---------- pozadí ----------

export interface MeshBlob {
  color: string;
  alpha: number;
}

/** Mesh gradient: plná báze + několik velkých měkkých radiálních přechodů (deterministicky ze seedu). */
export function mesh(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  base: string,
  blobs: MeshBlob[],
  seed: number,
  t = 0,
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  const r = rng(seed * 7919 + 13);
  const M = Math.max(w, h);
  blobs.forEach((b, i) => {
    const ph = r() * Math.PI * 2;
    const cx = x + w * (0.08 + r() * 0.84) + Math.sin(t * 0.35 + ph) * w * 0.04;
    const cy = y + h * (0.08 + r() * 0.84) + Math.cos(t * 0.28 + ph + i) * h * 0.03;
    const rad = M * (0.55 + r() * 0.45);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, rgba(b.color, b.alpha));
    g.addColorStop(0.45, rgba(b.color, b.alpha * 0.45));
    g.addColorStop(1, rgba(b.color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  });
  ctx.restore();
}

/** Jemná vinětace. */
export function vignette(ctx: CanvasRenderingContext2D, w: number, h: number, strength = 0.35, color = '#000000') {
  const g = ctx.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.85);
  g.addColorStop(0, rgba(color, 0));
  g.addColorStop(1, rgba(color, strength));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

let noiseTile: HTMLCanvasElement | null = null;
const patterns = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();

function getNoise(): HTMLCanvasElement | null {
  if (noiseTile) return noiseTile;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 192;
  const x = c.getContext('2d');
  if (!x) return null;
  const img = x.createImageData(192, 192);
  const r = rng(42);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.round(128 + (r() + r() + r() - 1.5) * 120);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, v));
    img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  noiseTile = c;
  return c;
}

/** Filmové zrno: dlaždice šumu (vygenerovaná jednou) v režimu overlay s nízkou průhledností. */
export function grain(ctx: CanvasRenderingContext2D, w: number, h: number, alpha = 0.08) {
  let pat = patterns.get(ctx);
  if (!pat) {
    const n = getNoise();
    if (!n) return;
    pat = ctx.createPattern(n, 'repeat') ?? undefined;
    if (!pat) return;
    patterns.set(ctx, pat);
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// ---------- fotky ----------

export function imageReady(img: HTMLImageElement | undefined): img is HTMLImageElement {
  return !!img && img.complete && img.naturalWidth > 0;
}

/** Fotka „object-fit: cover“ do obdélníku; zoom/drift pro Ken Burns. */
export function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  o: { zoom?: number; dx?: number; dy?: number } = {},
) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const s = Math.max(w / iw, h / ih) * (o.zoom ?? 1);
  const dw = iw * s;
  const dh = ih * s;
  const ox = x + (w - dw) / 2 + (o.dx ?? 0) * (dw - w) * 0.5;
  const oy = y + (h - dh) / 2 + (o.dy ?? 0) * (dh - h) * 0.5;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, ox, oy, dw, dh);
  ctx.restore();
}

/** Duotón přes obdélník: odbarvení, násobení světlou barvou, zesvětlení stínů tmavou. */
export function duotone(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  dark: string,
  light: string,
  strength = 1,
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.globalAlpha = strength;
  ctx.globalCompositeOperation = 'saturation';
  ctx.fillStyle = '#808080';
  ctx.fillRect(x, y, w, h);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = light;
  ctx.fillRect(x, y, w, h);
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = dark;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** Parametry Ken Burns pro scénu (pomalý zoom 1 → 1,12 a drift podle seedu). */
export function kenBurns(local: number | null, dur: number, seed: number, index: number) {
  if (local === null) return { zoom: 1.04, dx: 0, dy: 0 };
  const r = rng(seed * 31 + index * 7);
  const p = Math.max(0, Math.min(1, local / Math.max(0.1, dur)));
  const dirX = r() > 0.5 ? 1 : -1;
  const dirY = r() > 0.5 ? 1 : -1;
  return { zoom: 1 + 0.12 * p, dx: dirX * (p - 0.5) * 0.6, dy: dirY * (p - 0.5) * 0.4 };
}

export function linearScrim(
  ctx: CanvasRenderingContext2D,
  x: number,
  y0: number,
  w: number,
  y1: number,
  color: string,
  a0: number,
  a1: number,
) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, rgba(color, a0));
  g.addColorStop(0.55, rgba(color, (a0 + a1) * 0.6));
  g.addColorStop(1, rgba(color, a1));
  ctx.fillStyle = g;
  ctx.fillRect(x, Math.min(y0, y1), w, Math.abs(y1 - y0));
}

// ---------- značka ----------

export interface MarkOpts {
  size: number;
  color: string;
  /** Vyplněný podklad monogramu (jinak jen tenký obrys). */
  fill?: string;
  shape?: 'circle' | 'square';
}

/** Logo značky (pokud je načtené), jinak monogram z iniciál v nadpisovém fontu. */
export function drawMark(
  ctx: CanvasRenderingContext2D,
  name: string,
  profile: BrandProfile,
  logo: HTMLImageElement | undefined,
  x: number,
  y: number,
  o: MarkOpts,
) {
  const s = o.size;
  if (imageReady(logo)) {
    const k = Math.min(s / logo.naturalWidth, s / logo.naturalHeight);
    const lw = logo.naturalWidth * k;
    const lh = logo.naturalHeight * k;
    ctx.save();
    if (o.fill) {
      ctx.fillStyle = o.fill;
      ctx.beginPath();
      if (o.shape === 'square') roundRect(ctx, x, y, s, s, s * 0.22);
      else ctx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2);
      ctx.clip();
      const k2 = 0.78;
      ctx.drawImage(logo, x + (s - lw * k2) / 2, y + (s - lh * k2) / 2, lw * k2, lh * k2);
    } else ctx.drawImage(logo, x + (s - lw) / 2, y + (s - lh) / 2, lw, lh);
    ctx.restore();
    return;
  }
  const ini = initials(name).slice(0, 2);
  ctx.save();
  ctx.beginPath();
  if (o.shape === 'square') roundRect(ctx, x, y, s, s, s * 0.24);
  else ctx.arc(x + s / 2, y + s / 2, s / 2 - 1, 0, Math.PI * 2);
  if (o.fill) {
    ctx.fillStyle = o.fill;
    ctx.fill();
  } else {
    ctx.strokeStyle = o.color;
    ctx.lineWidth = Math.max(1.5, s * 0.035);
    ctx.stroke();
  }
  ctx.fillStyle = o.color;
  ctx.font = font(profile.fontHeading, s * (ini.length > 1 ? 0.38 : 0.46), 700);
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in c) c.letterSpacing = `${(s * 0.01).toFixed(1)}px`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ini, x + s / 2, y + s / 2 + s * 0.02);
  ctx.restore();
}

/** Monogram + název značky (prostrkané verzálky). Vrací šířku. */
export function drawLockup(
  ctx: CanvasRenderingContext2D,
  name: string,
  profile: BrandProfile,
  logo: HTMLImageElement | undefined,
  x: number,
  y: number,
  o: { size: number; color: string; fill?: string; markColor?: string; showName?: boolean; align?: 'left' | 'center' },
): number {
  const s = o.size;
  const style: TextStyle = { family: profile.fontBody, weight: 700, lineHeight: 1, tracking: 0.16, uppercase: true };
  const showName = o.showName !== false;
  const l = showName ? layoutText(ctx, name, s * 0.36, style, 10000, false) : null;
  const total = s + (l ? s * 0.32 + l.width : 0);
  const x0 = o.align === 'center' ? x - total / 2 : x;
  drawMark(ctx, name, profile, logo, x0, y, { size: s, color: o.markColor ?? o.color, fill: o.fill });
  if (l) drawLayout(ctx, l, x0 + s + s * 0.32, y + (s - l.lineH) / 2, o.color);
  return total;
}

// ---------- navigace, CTA ----------

export function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, color: string, lw = 3) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + len, y);
  ctx.moveTo(x + len - len * 0.32, y - len * 0.28);
  ctx.lineTo(x + len, y);
  ctx.lineTo(x + len - len * 0.32, y + len * 0.28);
  ctx.stroke();
  ctx.restore();
}

/** „02 / 05“ a šipka (na posledním slidu bez šipky). Zarovnáno vpravo k x, svisle na střed y. */
export function drawCounter(
  ctx: CanvasRenderingContext2D,
  family: string,
  i: number,
  n: number,
  xRight: number,
  yMid: number,
  color: string,
  size = 24,
) {
  if (n < 2) return;
  const isLast = i >= n - 1;
  const style: TextStyle = { family, weight: 600, lineHeight: 1, tracking: 0.08 };
  const label = `${String(i + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}`;
  setFont(ctx, style, size);
  const w = measure(ctx, label, style, size);
  const arrowW = isLast ? 0 : size * 1.9;
  const x = xRight - w - arrowW;
  ctx.save();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(label, x, yMid + 1);
  if (!isLast) drawArrow(ctx, xRight - size * 1.25, yMid, size * 1.25, color, Math.max(2, size * 0.1));
  ctx.restore();
}

export interface CtaOpts {
  family: string;
  size: number;
  bg: string;
  fg: string;
  /** Měřítko (puls). */
  scale?: number;
  alpha?: number;
  align?: 'left' | 'center';
  outline?: boolean;
}

/** CTA tlačítko (pilulka se šipkou). x = levá hrana / střed dle align, y = horní hrana. Vrací výšku. */
export function drawCta(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, o: CtaOpts): number {
  const style: TextStyle = { family: o.family, weight: 700, lineHeight: 1 };
  const s = o.size;
  setFont(ctx, style, s);
  const tw = measure(ctx, text, style, s);
  const padX = s * 1.05;
  const h = s * 2.5;
  const arrow = s * 1.0;
  const w = padX * 2 + tw + arrow + s * 0.7;
  const left = o.align === 'center' ? x - w / 2 : x;
  ctx.save();
  ctx.globalAlpha *= o.alpha ?? 1;
  const sc = o.scale ?? 1;
  if (sc !== 1) {
    const cx = left + w / 2;
    const cy = y + h / 2;
    ctx.translate(cx, cy);
    ctx.scale(sc, sc);
    ctx.translate(-cx, -cy);
  }
  roundRect(ctx, left, y, w, h, h / 2);
  if (o.outline) {
    ctx.strokeStyle = o.bg;
    ctx.lineWidth = Math.max(2, s * 0.09);
    ctx.stroke();
  } else {
    ctx.fillStyle = o.bg;
    ctx.fill();
  }
  ctx.fillStyle = o.outline ? o.bg : o.fg;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(text, left + padX, y + h / 2 + s * 0.04);
  drawArrow(ctx, left + padX + tw + s * 0.7, y + h / 2, arrow, o.outline ? o.bg : o.fg, Math.max(2, s * 0.11));
  ctx.restore();
  return h;
}

/** Segmentovaný progress story nahoře. */
export function storyProgress(
  ctx: CanvasRenderingContext2D,
  w: number,
  n: number,
  index: number,
  frac: number,
  color = '#ffffff',
) {
  const m = w * 0.03;
  const gap = 8;
  const segW = (w - m * 2 - gap * (n - 1)) / n;
  const y = w * 0.035;
  ctx.save();
  for (let i = 0; i < n; i++) {
    const x = m + i * (segW + gap);
    roundRect(ctx, x, y, segW, 6, 3);
    ctx.fillStyle = rgba(color, 0.35);
    ctx.fill();
    const f = i < index ? 1 : i === index ? frac : 0;
    if (f > 0) {
      roundRect(ctx, x, y, segW * f, 6, 3);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Tenká linka. */
export function rule(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, color: string, lw = 2) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y - lw / 2, w, lw);
}

export function isDark(hex: string) {
  return luminance(hex) < 0.25;
}

export { hexToRgb };
