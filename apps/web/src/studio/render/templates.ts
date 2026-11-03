// Osm šablon. Každá kreslí celý snímek v souřadnicích návrhu (šířka 1080) a umí statický i animovaný režim.
import type { TemplateId } from '@ms/core';
import { isSerif } from './fonts';
import {
  drawCounter,
  drawCover,
  drawCta,
  drawLockup,
  drawMark,
  duotone,
  grain,
  imageReady,
  kenBurns,
  linearScrim,
  mesh,
  rule,
  vignette,
} from './paint';
import { drawKinetic, drawLayout, fitText, layoutText, revealP, roundRect, setFont, wordCount, type Layout, type Reveal, type TextStyle } from './text';
import type { Scene, TemplateDraw } from './types';
import { clamp, easeOutCubic, mix, rgba } from './util';

// ---------- společné ----------

const rv = (s: Scene, start: number, stagger = 0.085, dur = 0.55): Reveal => ({
  local: s.video ? s.local : null,
  start,
  stagger,
  dur,
});

const fade = (s: Scene, start: number, dur = 0.5) => (s.video && s.local !== null ? easeOutCubic((s.local - start) / dur) : 1);

function headStyle(s: Scene, o: Partial<TextStyle> = {}): TextStyle {
  const serif = isSerif(s.fh);
  const wide = s.fh === 'Unbounded';
  return {
    family: s.fh,
    weight: serif ? 600 : wide ? 700 : 800,
    lineHeight: serif ? 1.04 : wide ? 1.05 : 0.98,
    tracking: serif ? -0.018 : wide ? -0.035 : -0.032,
    ...o,
  };
}

const bodyStyle = (s: Scene, o: Partial<TextStyle> = {}): TextStyle => ({
  family: s.fb,
  weight: 400,
  lineHeight: 1.38,
  tracking: 0,
  ...o,
});

const kickerStyle = (s: Scene, o: Partial<TextStyle> = {}): TextStyle => ({
  family: s.fb,
  weight: 700,
  lineHeight: 1.2,
  tracking: 0.2,
  uppercase: true,
  ...o,
});

function ctaScale(s: Scene): number {
  if (!s.video || s.local === null) return 1;
  const intro = easeOutCubic((s.local - 0.9) / 0.5);
  const pulse = 1 + 0.035 * Math.max(0, Math.sin((s.local - 1.4) * Math.PI * 2 * 0.9));
  return (0.85 + 0.15 * intro) * (s.local > 1.4 ? pulse : 1);
}

interface Compose {
  x: number;
  y: number;
  w: number;
  h: number;
  align?: 'left' | 'center';
  anchor?: 'top' | 'bottom' | 'center';
  kicker?: { color: string; size?: number; bar?: string } | null;
  headline: { color: string; maxSize: number; minSize?: number; style?: Partial<TextStyle>; lastLineColor?: string; maxLines?: number };
  body?: { color: string; size?: number; maxLines?: number; maxW?: number; kineticAccent?: string; kineticOn?: string } | null;
  cta?: { bg: string; fg: string; size?: number; outline?: boolean } | null;
  gaps?: { k?: number; b?: number; c?: number };
}

/** Sestaví blok nadtitulek → titulek → text → CTA; titulek dostane všechno zbývající místo (auto-fit). */
function compose(s: Scene, o: Compose): { top: number; bottom: number; head: Layout } {
  const { ctx } = s;
  const align = o.align ?? 'left';
  const ax = align === 'center' ? o.x + o.w / 2 : o.x;
  const gk = o.gaps?.k ?? 28;
  const gb = o.gaps?.b ?? 30;
  const gc = o.gaps?.c ?? 44;
  const kText = o.kicker ? s.slide.kicker?.trim() : '';
  const kL = kText && o.kicker ? layoutText(ctx, kText, o.kicker.size ?? 24, kickerStyle(s, { align }), o.w, false) : null;
  const bText = o.body ? s.slide.body?.trim() : '';
  const bSize = o.body?.size ?? 32;
  const bL =
    bText && o.body
      ? fitText(ctx, bText, bodyStyle(s, { align }), {
          maxW: o.body.maxW ?? o.w,
          maxH: bSize * 1.38 * (o.body.maxLines ?? 4),
          maxSize: bSize,
          minSize: bSize * 0.72,
          balance: true,
        })
      : null;
  const ctaH = o.cta && s.cta ? (o.cta.size ?? 30) * 2.5 : 0;
  const used = (kL ? kL.height + gk : 0) + (bL ? bL.height + gb : 0) + (ctaH ? ctaH + gc : 0);
  const head = fitText(ctx, s.slide.headline || ' ', headStyle(s, { align, ...o.headline.style }), {
    maxW: o.w,
    maxH: Math.max(80, o.h - used),
    maxSize: o.headline.maxSize,
    minSize: o.headline.minSize ?? 34,
    maxLines: o.headline.maxLines ?? 6,
  });
  const total = used + head.height;
  const anchor = o.anchor ?? 'top';
  let y = anchor === 'top' ? o.y : anchor === 'bottom' ? o.y + o.h - total : o.y + (o.h - total) / 2;
  const top = y;
  if (kL && o.kicker) {
    const p = fade(s, 0.05);
    ctx.save();
    ctx.globalAlpha *= p;
    if (o.kicker.bar) {
      const bw = 44;
      const kx = align === 'center' ? ax - kL.width / 2 - bw - 18 : ax;
      ctx.fillStyle = o.kicker.bar;
      ctx.fillRect(kx, y + kL.lineH / 2 - 1.5, bw * p, 3);
      drawLayout(ctx, kL, align === 'center' ? ax + (bw + 18) / 2 : ax + bw + 18, y, o.kicker.color);
    } else drawLayout(ctx, kL, ax, y, o.kicker.color, rv(s, 0.05));
    ctx.restore();
    y += kL.height + gk;
  }
  const n = head.lines.length;
  if (o.headline.lastLineColor && n > 1) {
    const a: Layout = { ...head, lines: head.lines.slice(0, -1), widths: head.widths.slice(0, -1), height: head.lineH * (n - 1) };
    const b: Layout = { ...head, lines: head.lines.slice(-1), widths: head.widths.slice(-1), height: head.lineH };
    drawLayout(ctx, a, ax, y, o.headline.color, rv(s, 0.22));
    drawLayout(ctx, b, ax, y + head.lineH * (n - 1), o.headline.lastLineColor, rv(s, 0.22 + 0.085 * (n - 1)));
  } else drawLayout(ctx, head, ax, y, o.headline.color, rv(s, 0.22));
  y += head.height;
  if (bL && o.body) {
    y += gb;
    if (s.video && s.local !== null && o.body.kineticAccent) {
      const words = Math.max(1, wordCount(bText ?? ''));
      drawKinetic(ctx, bL, ax, y, {
        color: o.body.color,
        accent: o.body.kineticAccent,
        onAccent: o.body.kineticOn ?? '#000',
        local: s.local,
        start: 0.75,
        perWord: clamp((s.dur - 1.3) / words, 0.12, 0.34),
      });
    } else drawLayout(ctx, bL, ax, y, o.body.color, rv(s, 0.5, 0.07));
    y += bL.height;
  }
  if (ctaH && o.cta && s.cta) {
    y += gc;
    drawCta(ctx, s.cta, ax, y, {
      family: s.fb,
      size: o.cta.size ?? 30,
      bg: o.cta.bg,
      fg: o.cta.fg,
      align,
      outline: o.cta.outline,
      scale: ctaScale(s),
      alpha: fade(s, 0.9),
    });
    y += ctaH;
  }
  return { top, bottom: y, head };
}

function photoOrNull(s: Scene) {
  return imageReady(s.img) ? s.img : undefined;
}

function footerY(s: Scene) {
  return s.box.y + s.box.h;
}

/** Spodní lišta: vlevo text (web/handle), vpravo počítadlo karuselu. */
function footer(s: Scene, color: string, lineColor: string | null, left?: string) {
  const { ctx } = s;
  const y = footerY(s);
  if (lineColor) rule(ctx, s.box.x, y - 46, s.box.w, lineColor, 1.5);
  const label = left ?? s.brand.profile.website?.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') ?? '';
  if (label) {
    const l = layoutText(ctx, label, 21, kickerStyle(s, { weight: 600, tracking: 0.12 }), s.box.w * 0.6, false);
    drawLayout(ctx, l, s.box.x, y - l.lineH + 4, color);
  }
  drawCounter(ctx, s.fb, s.i, s.video ? 1 : s.n, s.box.x + s.box.w, y - 10, color, 22);
}

// ---------- 1) editorial ----------

const editorial: TemplateDraw = (s) => {
  const { ctx, W, H, P, box } = s;
  const inverted = s.seed % 3 === 2;
  const bg = inverted ? P.deep : P.paper;
  const fg = inverted ? '#f6f2ea' : P.ink;
  const soft = inverted ? rgba('#f6f2ea', 0.68) : P.inkSoft;
  const accent = inverted ? P.accentOnDeep : P.primaryOnPaper;
  mesh(ctx, 0, 0, W, H, bg, [{ color: inverted ? P.primary : P.accent, alpha: inverted ? 0.28 : 0.16 }, { color: inverted ? P.secondary : P.primary, alpha: 0.06 }], s.seed, s.t);
  grain(ctx, W, H, inverted ? 0.1 : 0.12);

  // tiráž
  const mh = box.y;
  const ms = kickerStyle(s, { weight: 700, tracking: 0.24 });
  const name = layoutText(ctx, s.brand.name, 22, ms, box.w * 0.62, false);
  drawLayout(ctx, name, box.x, mh, fg);
  const issue = `Č. ${String((s.seed % 87) + 12)}${s.n > 1 ? ` — ${String(s.i + 1).padStart(2, '0')}` : ''}`;
  const il = layoutText(ctx, issue, 22, { ...ms, align: 'right', weight: 600 }, box.w * 0.4, false);
  drawLayout(ctx, il, box.x + box.w, mh, fg);
  rule(ctx, box.x, mh + 50, box.w, fg, 3);
  rule(ctx, box.x, mh + 60, box.w, fg, 1);

  const img = photoOrNull(s);
  let top = mh + 104;
  const bottom = footerY(s) - 84;
  if (img) {
    const ph = Math.round((bottom - top) * 0.5);
    const kb = kenBurns(s.local, s.dur, s.seed, s.i);
    drawCover(ctx, img, box.x, top, box.w, ph, kb);
    duotone(ctx, box.x, top, box.w, ph, mix(P.deep, '#000', 0.2), mix(P.paper, P.accent, 0.25), 0.18);
    top += ph + 46;
  } else {
    // velké číslo vydání jako typografický prvek (bez fotky)
    const big = layoutText(ctx, String(s.n > 1 ? s.i + 1 : (s.seed % 9) + 1).padStart(2, '0'), H * 0.2, headStyle(s, { weight: 300, italic: isSerif(s.fh), tracking: -0.04 }), box.w, false);
    ctx.save();
    ctx.globalAlpha = 0.09 * fade(s, 0);
    drawLayout(ctx, big, box.x + box.w - big.width, top - 10, fg);
    ctx.restore();
    top += H * 0.06;
  }
  compose(s, {
    x: box.x,
    y: top,
    w: box.w,
    h: bottom - top,
    anchor: img ? 'top' : 'bottom',
    kicker: { color: accent, size: 23, bar: accent },
    headline: { color: fg, maxSize: img ? 96 : s.video ? 132 : 128, minSize: 40, style: { weight: isSerif(s.fh) ? 500 : 800 } },
    body: { color: soft, size: 31, maxW: box.w * 0.86, maxLines: 4, kineticAccent: accent, kineticOn: bg },
    cta: { bg: fg, fg: bg, size: 28 },
  });
  footer(s, fg, rgba(fg, 0.85));
};

// ---------- 2) bold ----------

const bold: TemplateDraw = (s) => {
  const { ctx, W, H, P, box } = s;
  const img = photoOrNull(s);
  mesh(ctx, 0, 0, W, H, P.primary, [
    { color: mix(P.primary, '#000', 0.45), alpha: 0.75 },
    { color: mix(P.primary, '#fff', 0.25), alpha: 0.35 },
    { color: P.accent, alpha: 0.14 },
  ], s.seed, s.t);
  if (img) {
    drawCover(ctx, img, 0, 0, W, H, kenBurns(s.local, s.dur, s.seed, s.i));
    duotone(ctx, 0, 0, W, H, mix(P.primary, '#000', 0.55), mix(P.primary, '#fff', 0.35), 1);
    linearScrim(ctx, 0, H * 0.25, W, H, mix(P.primary, '#000', 0.6), 0, 0.75);
  }
  grain(ctx, W, H, 0.13);

  const fg = P.onPrimary;
  drawLockup(ctx, s.brand.name, s.brand.profile, s.logo, box.x, box.y, { size: 64, color: fg });
  drawCounter(ctx, s.fb, s.i, s.video ? 1 : s.n, box.x + box.w, box.y + 32, fg, 22);

  const carouselMid = s.n > 1 && !s.isLast && !s.video;
  const bandH = s.video ? H * 0.16 : H * (carouselMid ? 0.17 : 0.2);
  const bandLimit = s.video ? H * 0.8 - bandH : H - bandH;

  const kicker = s.slide.kicker?.trim();
  let hy = box.y + 130;
  if (kicker) {
    const kl = layoutText(ctx, kicker, 26, kickerStyle(s, { tracking: 0.16 }), box.w, false);
    const p = fade(s, 0.05);
    ctx.save();
    ctx.globalAlpha *= p;
    ctx.fillStyle = P.ink;
    ctx.fillRect(box.x, hy, (kl.width + 36) * p, kl.lineH + 26);
    drawLayout(ctx, kl, box.x + 18, hy + 13, '#ffffff');
    ctx.restore();
    hy += kl.lineH + 26 + 40;
  }
  const short = (s.slide.headline ?? '').length <= 34;
  const head = fitText(ctx, s.slide.headline || ' ', headStyle(s, { uppercase: short, lineHeight: short ? 1.0 : 0.98, weight: isSerif(s.fh) ? 700 : 800 }), {
    maxW: box.w,
    maxH: bandLimit - hy - 60,
    maxSize: s.video ? 170 : 190,
    minSize: 48,
    maxLines: 6,
  });
  // ve videu pás těsně pod titulkem (nad UI reelu), jinak u spodní hrany
  const bandY = s.video ? Math.min(bandLimit, hy + head.height + 90) : bandLimit;
  const bp = fade(s, 0.35, 0.6);
  ctx.fillStyle = P.accent;
  ctx.fillRect(0, bandY + bandH * (1 - bp), s.video ? W * 0.9 : W, bandH * bp);

  const n = head.lines.length;
  const hl = carouselMid ? null : P.accentOnPrimary;
  if (n > 1 && hl && hl !== fg) {
    drawLayout(ctx, { ...head, lines: head.lines.slice(0, -1), widths: head.widths.slice(0, -1) }, box.x, hy, fg, rv(s, 0.2));
    drawLayout(ctx, { ...head, lines: head.lines.slice(-1), widths: head.widths.slice(-1) }, box.x, hy + head.lineH * (n - 1), hl, rv(s, 0.2 + 0.085 * (n - 1)));
  } else drawLayout(ctx, head, box.x, hy, fg, rv(s, 0.2));

  // obsah pásu: text vlevo, vpravo CTA nebo šipka karuselu
  const inner = bandH - 60;
  const body = s.slide.body?.trim();
  let rightW = 0;
  if (s.cta) {
    const cs = 28;
    const ch = cs * 2.5;
    setFont(ctx, { family: s.fb, weight: 700, lineHeight: 1 }, cs);
    const cw = ctx.measureText(s.cta).width + cs * 3.8;
    rightW = body ? cw + 40 : 0;
    drawCta(ctx, s.cta, body ? box.x + box.w - cw : box.x, bandY + (bandH - ch) / 2, { family: s.fb, size: cs, bg: P.ink, fg: '#ffffff', scale: ctaScale(s), alpha: fade(s, 0.9) });
  } else if (carouselMid) {
    rightW = 120;
    ctx.save();
    ctx.globalAlpha *= bp;
    roundRect(ctx, box.x + box.w - 84, bandY + bandH / 2 - 42, 84, 84, 42);
    ctx.fillStyle = P.ink;
    ctx.fill();
    ctx.restore();
    drawArrowSmall(ctx, box.x + box.w - 42, bandY + bandH / 2, '#fff');
  }
  if (body && (!s.cta || rightW)) {
    const bl = fitText(ctx, body, bodyStyle(s, { weight: 500, lineHeight: 1.3 }), { maxW: box.w - rightW, maxH: inner, maxSize: 32, minSize: 20 });
    const by = bandY + (bandH - bl.height) / 2;
    if (s.video && s.local !== null)
      drawKinetic(ctx, bl, box.x, by, { color: P.onAccent, accent: P.ink, onAccent: '#fff', local: s.local, start: 0.8, perWord: clamp((s.dur - 1.3) / wordCount(body), 0.12, 0.34) });
    else drawLayout(ctx, bl, box.x, by, P.onAccent);
  }
};

function drawArrowSmall(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 14, cy);
  ctx.lineTo(cx + 14, cy);
  ctx.moveTo(cx + 3, cy - 11);
  ctx.lineTo(cx + 14, cy);
  ctx.lineTo(cx + 3, cy + 11);
  ctx.stroke();
  ctx.restore();
}

// ---------- 3) photo ----------

const photo: TemplateDraw = (s) => {
  const { ctx, W, H, P, box } = s;
  const img = photoOrNull(s);
  if (img) {
    drawCover(ctx, img, 0, 0, W, H, kenBurns(s.local, s.dur, s.seed, s.i));
  } else {
    // „atmosférická“ náhrada fotky: hluboký mesh se světlem a zrnem
    mesh(ctx, 0, 0, W, H, mix(P.deep, '#000', 0.25), [
      { color: P.primary, alpha: 0.85 },
      { color: P.accent, alpha: 0.5 },
      { color: mix(P.primary, '#fff', 0.3), alpha: 0.3 },
      { color: P.deep, alpha: 0.9 },
    ], s.seed + 3, s.t);
    vignette(ctx, W, H, 0.45);
  }
  const shade = mix(P.deep, '#000', 0.4);
  linearScrim(ctx, 0, 0, W, H * 0.22, shade, 0.45, 0);
  linearScrim(ctx, 0, H * 0.32, W, H, shade, 0, 0.92);
  grain(ctx, W, H, img ? 0.07 : 0.12);

  drawLockup(ctx, s.brand.name, s.brand.profile, s.logo, box.x, box.y, { size: 64, color: '#ffffff' });
  if (s.n > 1 && !s.video) {
    const label = `${s.i + 1}/${s.n}`;
    const st = kickerStyle(s, { tracking: 0.06, uppercase: false, weight: 600 });
    const l = layoutText(ctx, label, 24, st, 300, false);
    const pw = l.width + 36;
    roundRect(ctx, box.x + box.w - pw, box.y + 10, pw, 46, 23);
    ctx.fillStyle = 'rgba(0,0,0,.38)';
    ctx.fill();
    drawLayout(ctx, l, box.x + box.w - pw + 18, box.y + 10 + (46 - l.lineH) / 2, '#fff');
  }
  const bottom = s.video ? H * 0.8 : box.y + box.h - (s.n > 1 && !s.isLast ? 56 : 0);
  compose(s, {
    x: box.x,
    y: box.y + box.h * 0.3,
    w: box.w * 0.94,
    h: bottom - (box.y + box.h * 0.3),
    anchor: 'bottom',
    kicker: { color: mix(P.accent, '#fff', 0.15), size: 24, bar: P.accent },
    headline: { color: '#ffffff', maxSize: 116, minSize: 42, style: { lineHeight: isSerif(s.fh) ? 1.02 : 0.98 } },
    body: { color: 'rgba(255,255,255,.82)', size: 31, maxLines: 3, kineticAccent: P.accent, kineticOn: P.onAccent },
    cta: { bg: P.accent, fg: P.onAccent, size: 30 },
  });
  if (s.n > 1 && !s.isLast && !s.video) {
    const y = box.y + box.h - 10;
    const l = layoutText(ctx, 'Posuňte', 21, kickerStyle(s, { tracking: 0.18 }), 400, false);
    drawLayout(ctx, l, box.x + box.w - l.width - 50, y - l.lineH / 2 - 1, 'rgba(255,255,255,.8)');
    drawArrowSmall(ctx, box.x + box.w - 16, y, 'rgba(255,255,255,.85)');
  }
};

// ---------- 4) quote ----------

const quote: TemplateDraw = (s) => {
  const { ctx, W, H, P, box } = s;
  const dark = s.seed % 2 === 1;
  const bg = dark ? P.deep : P.paper;
  const fg = dark ? '#f7f3ec' : P.ink;
  const soft = dark ? rgba('#f7f3ec', 0.66) : P.inkSoft;
  const mark = dark ? P.accentOnDeep : P.primaryOnPaper;
  mesh(ctx, 0, 0, W, H, bg, [{ color: dark ? P.primary : P.accent, alpha: dark ? 0.3 : 0.14 }], s.seed + 5, s.t);
  grain(ctx, W, H, 0.11);

  // velké uvozovky
  const qStyle = headStyle(s, { weight: isSerif(s.fh) ? 600 : 800, lineHeight: 1, tracking: 0 });
  const ql = layoutText(ctx, '\u201c', 300, qStyle, 600, false);
  ctx.save();
  ctx.globalAlpha *= fade(s, 0, 0.6);
  drawLayout(ctx, ql, box.x - 14, box.y - 70 + (1 - fade(s, 0, 0.6)) * 30, mark);
  ctx.restore();

  const img = photoOrNull(s);
  const top = box.y + 190;
  const bottom = footerY(s) - 110;
  const author = s.slide.kicker?.trim() || s.brand.name;
  const authorH = 90;
  const r = compose(s, {
    x: box.x,
    y: top,
    w: box.w * 0.94,
    h: bottom - top - authorH,
    anchor: 'center',
    headline: {
      color: fg,
      maxSize: 88,
      minSize: 38,
      style: { weight: isSerif(s.fh) ? 400 : 600, italic: isSerif(s.fh), lineHeight: 1.16, tracking: isSerif(s.fh) ? -0.01 : -0.02 },
      maxLines: 7,
    },
    body: { color: soft, size: 28, maxLines: 3, kineticAccent: mark, kineticOn: bg },
    cta: { bg: fg, fg: bg, size: 28 },
    gaps: { b: 34 },
  });
  // autor
  const ay = r.bottom + 50;
  const p = fade(s, 0.6);
  ctx.save();
  ctx.globalAlpha *= p;
  let ax = box.x;
  if (img) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(ax + 36, ay + 18, 36, 0, Math.PI * 2);
    ctx.clip();
    drawCover(ctx, img, ax, ay - 18, 72, 72);
    ctx.restore();
    ax += 96;
  } else {
    rule(ctx, ax, ay + 18, 64 * p, mark, 3);
    ax += 88;
  }
  const al = layoutText(ctx, author, 23, kickerStyle(s, { tracking: 0.18 }), box.w - 120, false);
  drawLayout(ctx, al, ax, ay + 18 - al.lineH / 2, fg);
  ctx.restore();
  footer(s, soft, null, `@${handleOf(s.brand.name)}`);
};

export function handleOf(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9._]+/g, '')
      .slice(0, 28) || 'znacka'
  );
}

// ---------- 5) list ----------

function splitItems(body: string | undefined): string[] {
  if (!body) return [];
  const parts = body
    .split(/\n|;|•|·|\s[–-]\s|(?:^|\s)\d+[.)]\s/)
    .map((p) => p.trim().replace(/^[-–•]\s*/, ''))
    .filter((p) => p.length > 1);
  return parts.length >= 2 ? parts.slice(0, 6) : [];
}

const list: TemplateDraw = (s) => {
  const { ctx, W, H, P, box } = s;
  const bg = mix(P.paper, P.primary, 0.05);
  mesh(ctx, 0, 0, W, H, bg, [{ color: P.accent, alpha: 0.12 }, { color: P.primary, alpha: 0.05 }], s.seed + 9, s.t);
  grain(ctx, W, H, 0.11);
  const fg = P.ink;
  const acc = P.primaryOnPaper;

  drawLockup(ctx, s.brand.name, s.brand.profile, s.logo, box.x, box.y, { size: 56, color: fg, markColor: acc });
  // segmentový průběh karuselu
  if (s.n > 1) {
    const segs = s.n;
    const sw = Math.min(46, (box.w * 0.4) / segs);
    for (let k = 0; k < segs; k++) {
      ctx.fillStyle = k <= s.i ? acc : rgba(fg, 0.14);
      ctx.fillRect(box.x + box.w - (segs - k) * (sw + 6) + 6, box.y + 26, sw, 5);
    }
  }
  const cover = s.n > 1 && s.i === 0;
  const step = s.n > 1 ? s.i : 0;
  const ctaSlide = s.n > 1 && s.isLast && !!s.cta;
  const top = box.y + 130;
  const bottom = footerY(s) - 80;
  const items = s.n === 1 ? splitItems(s.slide.body) : [];

  if (cover || ctaSlide || (s.n === 1 && !items.length)) {
    const r = compose(s, {
      x: box.x,
      y: top,
      w: box.w,
      h: bottom - top - (cover && s.n >= 3 ? Math.min(4, s.n - 1) * 62 + 40 : 0),
      anchor: cover ? 'top' : 'center',
      kicker: { color: acc, size: 24, bar: acc },
      headline: { color: fg, maxSize: cover ? 136 : 112, minSize: 44 },
      body: { color: P.inkSoft, size: 32, maxLines: 3, kineticAccent: P.accent, kineticOn: P.onAccent },
      cta: { bg: P.primary, fg: P.onPrimary, size: 32 },
    });
    if (cover && s.n >= 3) {
      // obsah karuselu – další titulky
      const rest = s.design.slides.slice(1, 5);
      let y = Math.max(r.bottom + 50, bottom - rest.length * 62);
      rest.forEach((sl, k) => {
        const p = fade(s, 0.7 + k * 0.08);
        ctx.save();
        ctx.globalAlpha *= p;
        rule(ctx, box.x, y, box.w, rgba(fg, 0.16), 1.5);
        const num = layoutText(ctx, String(k + 1).padStart(2, '0'), 22, kickerStyle(s, { tracking: 0.1 }), 80, false);
        drawLayout(ctx, num, box.x, y + 18, acc);
        const t = layoutText(ctx, sl.headline, 26, bodyStyle(s, { weight: 500 }), box.w - 90, false);
        drawLayout(ctx, { ...t, lines: t.lines.slice(0, 1), widths: t.widths.slice(0, 1), height: t.lineH }, box.x + 70, y + 14, fg);
        ctx.restore();
        y += 62;
      });
    }
  } else if (items.length) {
    // jednoobrázkový seznam: titulek + číslované položky
    const k = s.slide.kicker?.trim();
    let y = top;
    if (k) {
      const kl = layoutText(ctx, k, 24, kickerStyle(s), box.w, false);
      drawLayout(ctx, kl, box.x, y, acc, rv(s, 0.05));
      y += kl.height + 26;
    }
    const rowH = Math.min(118, (bottom - y) * 0.55 / items.length);
    const head = fitText(ctx, s.slide.headline, headStyle(s), { maxW: box.w, maxH: bottom - y - rowH * items.length - 40, maxSize: 104, minSize: 40 });
    drawLayout(ctx, head, box.x, y, fg, rv(s, 0.2));
    y = bottom - rowH * items.length;
    items.forEach((it, idx) => {
      const p = fade(s, 0.55 + idx * 0.1);
      ctx.save();
      ctx.globalAlpha *= p;
      rule(ctx, box.x, y, box.w, rgba(fg, 0.18), 1.5);
      const num = layoutText(ctx, String(idx + 1).padStart(2, '0'), rowH * 0.36, headStyle(s, { weight: 700, tracking: -0.02 }), 140, false);
      drawLayout(ctx, num, box.x, y + (rowH - num.lineH) / 2, acc);
      const t = fitText(ctx, it, bodyStyle(s, { weight: 500, lineHeight: 1.25 }), { maxW: box.w - 120, maxH: rowH - 20, maxSize: 32, minSize: 20 });
      drawLayout(ctx, t, box.x + 120, y + (rowH - t.height) / 2, fg);
      ctx.restore();
      y += rowH;
    });
  } else {
    // krok karuselu: velké číslo, titulek, text
    const numStyle = headStyle(s, { weight: isSerif(s.fh) ? 500 : 800, tracking: -0.05, lineHeight: 0.9 });
    const num = layoutText(ctx, String(step).padStart(2, '0'), Math.min(300, H * 0.2), numStyle, box.w, false);
    const p = fade(s, 0, 0.7);
    ctx.save();
    ctx.globalAlpha *= p;
    drawLayout(ctx, num, box.x - 6, top - 20 + (1 - p) * 40, acc);
    ctx.restore();
    const ny = top + num.height + 30;
    rule(ctx, box.x, ny, box.w * fade(s, 0.15, 0.8), rgba(fg, 0.85), 2);
    compose(s, {
      x: box.x,
      y: ny + 50,
      w: box.w,
      h: bottom - ny - 50,
      anchor: 'top',
      kicker: { color: acc, size: 23 },
      headline: { color: fg, maxSize: 92, minSize: 40 },
      body: { color: P.inkSoft, size: 33, maxLines: 5, kineticAccent: P.accent, kineticOn: P.onAccent },
      cta: { bg: P.primary, fg: P.onPrimary, size: 30 },
    });
  }
  footer(s, P.inkSoft, rgba(fg, 0.14));
};

// ---------- 6) minimal ----------

const minimal: TemplateDraw = (s) => {
  const { ctx, W, H, P, box } = s;
  const bg = mix('#fbfaf7', P.primary, 0.025);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  grain(ctx, W, H, 0.08);
  const fg = P.ink;
  drawMark(ctx, s.brand.name, s.brand.profile, s.logo, box.x, box.y, { size: 58, color: fg });
  if (s.n > 1) drawCounter(ctx, s.fb, s.i, s.video ? 1 : s.n, box.x + box.w, box.y + 29, P.inkSoft, 21);
  const top = box.y + box.h * 0.34;
  const bottom = footerY(s) - 120;
  compose(s, {
    x: box.x,
    y: top,
    w: box.w * 0.82,
    h: bottom - top,
    anchor: 'bottom',
    kicker: { color: P.primaryOnPaper, size: 21, bar: P.primaryOnPaper },
    headline: {
      color: fg,
      maxSize: s.video ? 92 : 84,
      minSize: 36,
      style: { weight: isSerif(s.fh) ? 400 : 600, tracking: isSerif(s.fh) ? -0.02 : -0.035, lineHeight: 1.08 },
    },
    body: { color: P.inkSoft, size: 27, maxLines: 4, maxW: box.w * 0.72, kineticAccent: P.accent, kineticOn: P.onAccent },
    cta: { bg: fg, fg: bg, size: 26, outline: true },
    gaps: { k: 34, b: 34, c: 46 },
  });
  const fy = footerY(s);
  rule(ctx, box.x, fy - 46, box.w, rgba(fg, 0.12), 1.5);
  const nameL = layoutText(ctx, s.brand.name, 20, kickerStyle(s, { weight: 600, tracking: 0.2 }), box.w * 0.6, false);
  drawLayout(ctx, nameL, box.x, fy - nameL.lineH + 4, P.inkSoft);
  const web = s.brand.profile.website?.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  if (web) {
    const wl = layoutText(ctx, web, 20, kickerStyle(s, { weight: 500, tracking: 0.08, uppercase: false, align: 'right' }), box.w * 0.4, false);
    drawLayout(ctx, wl, box.x + box.w, fy - wl.lineH + 4, P.inkSoft);
  }
};

// ---------- 7) split ----------

const split: TemplateDraw = (s) => {
  const { ctx, W, H, P } = s;
  const vertical = H / W > 1.5;
  const flip = s.i % 2 === 1;
  const img = photoOrNull(s);
  const bg = P.paper;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  grain(ctx, W, H, 0.1);
  const slideP = fade(s, 0, 0.8);
  // fotka / barevné pole
  const pr = vertical
    ? { x: 0, y: flip ? H * 0.5 : 0, w: W, h: H * 0.5 }
    : { x: flip ? W * 0.5 : 0, y: 0, w: W * 0.5, h: H };
  ctx.save();
  ctx.beginPath();
  if (vertical) ctx.rect(pr.x, pr.y, pr.w, pr.h * (s.video ? slideP : 1));
  else ctx.rect(pr.x, pr.y, pr.w, pr.h);
  ctx.clip();
  if (img) {
    drawCover(ctx, img, pr.x, pr.y, pr.w, pr.h, kenBurns(s.local, s.dur, s.seed, s.i));
    duotone(ctx, pr.x, pr.y, pr.w, pr.h, mix(P.deep, '#000', 0.1), mix('#ffffff', P.accent, 0.2), 0.15);
  } else {
    mesh(ctx, pr.x, pr.y, pr.w, pr.h, P.primary, [
      { color: mix(P.primary, '#000', 0.5), alpha: 0.8 },
      { color: P.accent, alpha: 0.35 },
      { color: mix(P.primary, '#fff', 0.25), alpha: 0.3 },
    ], s.seed + s.i, s.t);
    grain(ctx, W, H, 0.12);
    // typografický prvek: velké obrysové číslo
    const numStyle = headStyle(s, { weight: isSerif(s.fh) ? 400 : 800, tracking: -0.05, lineHeight: 0.9 });
    const num = layoutText(ctx, String(s.i + 1).padStart(2, '0'), Math.min(pr.w, pr.h) * 0.62, numStyle, pr.w * 2, false);
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = rgba(P.onPrimary, 0.55);
    ctx.lineWidth = 2.5;
    ctx.font = `${numStyle.weight} ${num.size}px ${ctx.font.split('px ')[1] ?? 'serif'}`;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.strokeText(String(s.i + 1).padStart(2, '0'), pr.x + s.m * 0.8, pr.y + pr.h - s.m * 0.9);
    ctx.restore();
    drawMark(ctx, s.brand.name, s.brand.profile, s.logo, pr.x + s.m * 0.8, pr.y + s.m * 0.8 + (vertical ? H * 0.06 : 0), { size: 60, color: P.onPrimary });
  }
  ctx.restore();

  const tr = vertical
    ? { x: s.m, y: (flip ? 0 : H * 0.5) + s.m * 0.9, w: W - s.m * 2 - (s.video ? W * 0.08 : 0), h: H * 0.5 - s.m * 1.8 }
    : { x: (flip ? 0 : W * 0.5) + s.m * 0.75, y: s.box.y, w: W * 0.5 - s.m * 1.5, h: s.box.h };
  if (vertical) {
    if (flip) tr.y += H * 0.08;
    else tr.h -= H * 0.12;
  }
  const textP = vertical ? 1 : fade(s, 0.1, 0.7);
  ctx.save();
  ctx.globalAlpha *= textP;
  if (img || vertical) {
    drawLockup(ctx, s.brand.name, s.brand.profile, s.logo, tr.x, tr.y, { size: 50, color: P.ink, markColor: P.primaryOnPaper, showName: !vertical || true });
  } else {
    const nl = layoutText(ctx, s.brand.name, 19, kickerStyle(s, { tracking: 0.22 }), tr.w, false);
    drawLayout(ctx, nl, tr.x, tr.y + 14, P.inkSoft);
  }
  ctx.restore();
  compose(s, {
    x: tr.x,
    y: tr.y + 110,
    w: tr.w,
    h: tr.h - 110 - (vertical ? 0 : 70),
    anchor: vertical ? 'top' : 'bottom',
    kicker: { color: P.primaryOnPaper, size: 21 },
    headline: { color: P.ink, maxSize: vertical ? 104 : 80, minSize: 32 },
    body: { color: P.inkSoft, size: vertical ? 32 : 26, maxLines: vertical ? 3 : 6, kineticAccent: P.accent, kineticOn: P.onAccent },
    cta: { bg: P.primary, fg: P.onPrimary, size: vertical ? 30 : 24 },
    gaps: { k: 22, b: 24, c: 36 },
  });
  if (!vertical) drawCounter(ctx, s.fb, s.i, s.video ? 1 : s.n, tr.x + tr.w, s.box.y + s.box.h - 10, P.inkSoft, 21);
};

// ---------- 8) gradient ----------

const gradient: TemplateDraw = (s) => {
  const { ctx, W, H, P, box } = s;
  const img = photoOrNull(s);
  const base = mix(P.deep, P.primary, 0.12);
  if (img) {
    drawCover(ctx, img, 0, 0, W, H, kenBurns(s.local, s.dur, s.seed, s.i));
    ctx.save();
    ctx.globalAlpha = 0.78;
    mesh(ctx, 0, 0, W, H, base, [{ color: P.primary, alpha: 0.9 }, { color: P.accent, alpha: 0.55 }], s.seed, s.t);
    ctx.restore();
  } else {
    mesh(ctx, 0, 0, W, H, base, [
      { color: P.primary, alpha: 0.95 },
      { color: P.accent, alpha: 0.7 },
      { color: mix(P.primary, '#ffffff', 0.35), alpha: 0.45 },
      { color: P.deep, alpha: 0.9 },
      { color: mix(P.accent, P.primary, 0.5), alpha: 0.5 },
    ], s.seed + 17, s.t);
  }
  vignette(ctx, W, H, 0.3, P.deep);
  grain(ctx, W, H, 0.16);
  // jemný vnitřní rámeček
  ctx.strokeStyle = 'rgba(255,255,255,.22)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(s.m * 0.5, s.m * 0.5, W - s.m, H - s.m);

  if (s.n > 1) drawCounter(ctx, s.fb, s.i, s.video ? 1 : s.n, box.x + box.w, box.y + 20, 'rgba(255,255,255,.85)', 21);
  const nameL = layoutText(ctx, s.brand.name, 20, kickerStyle(s, { tracking: 0.26 }), box.w * 0.6, false);
  drawLayout(ctx, nameL, box.x, box.y + 20 - nameL.lineH / 2, 'rgba(255,255,255,.85)');

  const markS = 68;
  const bottom = s.video ? H * 0.78 : box.y + box.h - markS - 40;
  compose(s, {
    x: box.x + box.w * 0.04,
    y: box.y + 110,
    w: box.w * 0.92,
    h: bottom - box.y - 110,
    align: 'center',
    anchor: 'center',
    kicker: { color: 'rgba(255,255,255,.88)', size: 23 },
    headline: { color: '#ffffff', maxSize: 124, minSize: 42, style: { lineHeight: isSerif(s.fh) ? 1.04 : 1 } },
    body: { color: 'rgba(255,255,255,.8)', size: 31, maxLines: 4, maxW: box.w * 0.82, kineticAccent: '#ffffff', kineticOn: P.deep },
    cta: { bg: '#ffffff', fg: P.ink, size: 30 },
  });
  drawMark(ctx, s.brand.name, s.brand.profile, s.logo, W / 2 - markS / 2, s.video ? H * 0.8 : box.y + box.h - markS, { size: markS, color: '#ffffff' });
};

export const DRAW: Record<TemplateId, TemplateDraw> = { editorial, bold, photo, quote, list, minimal, split, gradient };

export { revealP };
