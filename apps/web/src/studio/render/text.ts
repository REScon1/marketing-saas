// Sazba textu na canvasu: zalamování (čeština, jednopísmenné předložky), auto-fit, vyvážené řádky,
// prostrkání (tracking), animované odhalování po řádcích a „kinetic captions“ po slovech.
import { font } from './fonts';
import { clamp, easeOutCubic, rgba } from './util';

export interface TextStyle {
  family: string;
  weight: number;
  italic?: boolean;
  /** Násobek velikosti písma. */
  lineHeight: number;
  /** Prostrkání v em (0.12 = 12 %). */
  tracking?: number;
  uppercase?: boolean;
  align?: 'left' | 'center' | 'right';
}

export interface Layout {
  size: number;
  lines: string[];
  widths: number[];
  /** Šířka nejdelšího řádku. */
  width: number;
  height: number;
  lineH: number;
  style: TextStyle;
}

const NBSP = ' ';
// Jednopísmenné předložky a spojky nesmí zůstat na konci řádku (česká typografická norma).
const ONE_LETTER = /^(?:[ksvzouaiKSVZOUAI]|\d{1,3})$/;

function prepare(text: string, style: TextStyle): string[][] {
  const t = style.uppercase ? text.toLocaleUpperCase('cs') : text;
  return t.split(/\n/).map((para) => {
    const raw = para.split(/[ \t]+/).filter(Boolean);
    const out: string[] = [];
    for (let i = 0; i < raw.length; i++) {
      let w = raw[i]!;
      while (ONE_LETTER.test(w.split(NBSP).pop() ?? '') && i + 1 < raw.length) w = `${w}${NBSP}${raw[++i]}`;
      out.push(w);
    }
    return out;
  });
}

export function setFont(ctx: CanvasRenderingContext2D, style: TextStyle, size: number) {
  ctx.font = font(style.family, size, style.weight, style.italic);
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in c) c.letterSpacing = `${((style.tracking ?? 0) * size).toFixed(2)}px`;
}

const hasLS = (ctx: CanvasRenderingContext2D) => 'letterSpacing' in ctx;

export function measure(ctx: CanvasRenderingContext2D, s: string, style: TextStyle, size: number): number {
  const str = s.replace(/ /g, ' ');
  const w = ctx.measureText(str).width;
  if (hasLS(ctx) || !style.tracking) return w;
  return w + style.tracking * size * Math.max(0, str.length - 1);
}

function wrap(ctx: CanvasRenderingContext2D, paras: string[][], style: TextStyle, size: number, maxW: number): string[] {
  const lines: string[] = [];
  for (const words of paras) {
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (cur && measure(ctx, next, style, size) > maxW) {
        lines.push(cur);
        cur = w;
      } else cur = next;
    }
    lines.push(cur);
  }
  return lines;
}

/** Sazba textu v dané velikosti; balance = vyrovná délky řádků (jako text-wrap: balance). */
export function layoutText(
  ctx: CanvasRenderingContext2D,
  text: string,
  size: number,
  style: TextStyle,
  maxW: number,
  balance = true,
): Layout {
  setFont(ctx, style, size);
  const paras = prepare(text, style);
  let lines = wrap(ctx, paras, style, size, maxW);
  if (balance && lines.length > 1) {
    const n = lines.length;
    let lo = maxW * 0.45;
    let hi = maxW;
    for (let i = 0; i < 9; i++) {
      const mid = (lo + hi) / 2;
      if (wrap(ctx, paras, style, size, mid).length > n) lo = mid;
      else hi = mid;
    }
    lines = wrap(ctx, paras, style, size, hi);
  }
  const widths = lines.map((l) => measure(ctx, l, style, size));
  const lineH = size * style.lineHeight;
  return { size, lines, widths, width: Math.max(0, ...widths), height: lines.length * lineH, lineH, style };
}

export interface FitOptions {
  maxW: number;
  maxH: number;
  maxSize: number;
  minSize: number;
  maxLines?: number;
  balance?: boolean;
}

/** Největší velikost písma, při které se text vejde do boxu (binární hledání). */
export function fitText(ctx: CanvasRenderingContext2D, text: string, style: TextStyle, o: FitOptions): Layout {
  const ok = (l: Layout) =>
    l.height <= o.maxH && l.width <= o.maxW + 0.5 && (!o.maxLines || l.lines.length <= o.maxLines);
  let lo = o.minSize;
  let hi = o.maxSize;
  let best = layoutText(ctx, text, lo, style, o.maxW, o.balance ?? true);
  const top = layoutText(ctx, text, hi, style, o.maxW, o.balance ?? true);
  if (ok(top)) return top;
  for (let i = 0; i < 10 && hi - lo > 0.75; i++) {
    const mid = (lo + hi) / 2;
    const l = layoutText(ctx, text, mid, style, o.maxW, o.balance ?? true);
    if (ok(l)) {
      best = l;
      lo = mid;
    } else hi = mid;
  }
  return best;
}

export interface Reveal {
  /** Lokální čas scény (s). null = statický snímek (vše viditelné). */
  local: number | null;
  start?: number;
  stagger?: number;
  dur?: number;
}

export function revealP(r: Reveal | undefined, i = 0): number {
  if (!r || r.local === null) return 1;
  const s = (r.start ?? 0) + i * (r.stagger ?? 0.09);
  return easeOutCubic((r.local - s) / (r.dur ?? 0.55));
}

function drawString(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, style: TextStyle, size: number) {
  const str = s.replace(/ /g, ' ');
  if (hasLS(ctx) || !style.tracking) {
    ctx.fillText(str, x, y);
    return;
  }
  const sp = style.tracking * size;
  let cx = x;
  for (const ch of str) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + sp;
  }
}

/** Vykreslí sazbu; y = horní hrana bloku, x podle zarovnání (left: levý okraj, center: střed). Vrací spodní hranu. */
export function drawLayout(
  ctx: CanvasRenderingContext2D,
  l: Layout,
  x: number,
  y: number,
  color: string,
  reveal?: Reveal,
): number {
  setFont(ctx, l.style, l.size);
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const align = l.style.align ?? 'left';
  l.lines.forEach((line, i) => {
    const w = l.widths[i] ?? 0;
    const lx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    const top = y + i * l.lineH;
    const base = top + l.lineH * 0.5 + l.size * 0.34;
    const p = revealP(reveal, i);
    if (p <= 0) return;
    if (p >= 1) {
      drawString(ctx, line, lx, base, l.style, l.size);
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(lx - l.size, top - l.size * 0.25, w + l.size * 2, l.lineH + l.size * 0.45);
    ctx.clip();
    ctx.globalAlpha *= clamp(p * 1.4);
    drawString(ctx, line, lx, base + (1 - p) * l.lineH * 1.05, l.style, l.size);
    ctx.restore();
  });
  return y + l.height;
}

/** Kinetické titulky: slova se postupně zvýrazňují (karaoke), aktivní slovo dostane podklad v akcentu. */
export function drawKinetic(
  ctx: CanvasRenderingContext2D,
  l: Layout,
  x: number,
  y: number,
  o: { color: string; accent: string; onAccent: string; local: number | null; start: number; perWord: number },
): number {
  setFont(ctx, l.style, l.size);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const align = l.style.align ?? 'left';
  let wi = 0;
  const active = o.local === null ? Infinity : (o.local - o.start) / o.perWord;
  const space = measure(ctx, ' ', l.style, l.size);
  l.lines.forEach((line, i) => {
    const w = l.widths[i] ?? 0;
    let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    const top = y + i * l.lineH;
    const base = top + l.lineH * 0.5 + l.size * 0.34;
    const lineP = o.local === null ? 1 : easeOutCubic((o.local - o.start + 0.25 - i * 0.08) / 0.4);
    for (const word of line.split(' ')) {
      const ww = measure(ctx, word, l.style, l.size);
      const d = active - wi;
      ctx.save();
      ctx.globalAlpha *= lineP;
      if (d >= 0 && d < 1 && o.local !== null) {
        const k = easeOutCubic(d * 3);
        const padX = l.size * 0.18;
        ctx.fillStyle = o.accent;
        roundRect(ctx, cx - padX, top + l.lineH * 0.08 + (1 - k) * 6, ww + padX * 2, l.lineH * 0.86, l.size * 0.16);
        ctx.fill();
        ctx.fillStyle = o.onAccent;
      } else {
        ctx.fillStyle = d >= 1 ? o.color : rgba(o.color.startsWith('#') ? o.color : '#ffffff', 0.42);
      }
      drawString(ctx, word, cx, base + (1 - lineP) * 18, l.style, l.size);
      ctx.restore();
      cx += ww + space;
      wi++;
    }
  });
  return y + l.height;
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
