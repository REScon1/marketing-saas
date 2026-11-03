// Export: PNG v plném rozlišení a video (canvas.captureStream + MediaRecorder) v reálném čase.
import type { DesignSpec } from '@ms/core';
import { drawFrame, isVideo, sizeFor, totalDuration } from './engine';
import { ensureFonts } from './fonts';
import { loadImages } from './images';
import type { BrandLook } from './types';

function canvasToBlob(c: HTMLCanvasElement, type = 'image/png', q?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b && b.size > 0 ? resolve(b) : reject(new Error('Export obrázku se nezdařil.'))), type, q),
  );
}

/** PNG slidu v plném rozlišení (1080×…). U reel/story se vykreslí plakátový snímek scény. */
export async function exportPng(design: DesignSpec, brand: BrandLook, slide = 0): Promise<Blob> {
  await ensureFonts(brand.profile);
  const images = await loadImages(design, brand.profile.logoUrl);
  const { w, h } = sizeFor(design.aspect);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Prohlížeč nepodporuje kreslení na canvas.');
  const t = isVideo(design) ? (totalDuration(design) / Math.max(1, design.slides.length)) * slide + 1.6 : 0;
  drawFrame(ctx, { design, brand, slide, t, w, h, images });
  return canvasToBlob(c);
}

const MIME_CANDIDATES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

export function pickVideoMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* noop */
    }
  }
  return null;
}

export interface ExportVideoOptions {
  /** Zmenšení výstupu (1 = 1080×1920, 0.5 = 540×960). */
  scale?: number;
  fps?: number;
  /** Segmentový progress u story (výchozí true). */
  progress?: boolean;
  signal?: AbortSignal;
}

/** Nahraje reel/story jako video. Běží v reálném čase (délka = totalDuration). */
export async function exportVideo(
  design: DesignSpec,
  brand: BrandLook,
  onProgress?: (p: number) => void,
  opts: ExportVideoOptions = {},
): Promise<{ blob: Blob; mime: string }> {
  if (typeof document === 'undefined' || typeof MediaRecorder === 'undefined')
    throw new Error('Tento prohlížeč neumí nahrávat video (chybí MediaRecorder). Zkuste aktuální Chrome, Edge nebo Firefox.');
  const mime = pickVideoMime();
  if (!mime) throw new Error('Prohlížeč nepodporuje žádný formát videa pro export (MP4 ani WebM).');
  await ensureFonts(brand.profile);
  const images = await loadImages(design, brand.profile.logoUrl);
  const base = sizeFor('9:16');
  const scale = Math.max(0.1, Math.min(1, opts.scale ?? 1));
  const c = document.createElement('canvas');
  c.width = Math.round(base.w * scale);
  c.height = Math.round(base.h * scale);
  const ctx = c.getContext('2d');
  if (!ctx || typeof c.captureStream !== 'function') throw new Error('Prohlížeč neumí zachytit canvas jako video.');
  const vdesign: DesignSpec = { ...design, aspect: '9:16' };
  const total = totalDuration(vdesign);
  const fps = opts.fps ?? 30;
  const draw = (t: number) => {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawFrame(ctx, { design: vdesign, brand, slide: 0, t, w: base.w, h: base.h, images, progress: opts.progress });
  };
  draw(0);
  const stream = c.captureStream(fps);
  const bitrate = Math.round(8_000_000 * scale * scale) + 1_000_000;
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
  } catch {
    throw new Error('Nahrávání videa se nepodařilo spustit.');
  }
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size) chunks.push(e.data);
  };
  const done = new Promise<void>((resolve, reject) => {
    rec.onstop = () => resolve();
    rec.onerror = () => reject(new Error('Nahrávání videa selhalo.'));
  });
  rec.start(250);
  const start = performance.now();
  await new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (opts.signal?.aborted) {
        reject(new Error('Export videa byl zrušen.'));
        return;
      }
      const t = (performance.now() - start) / 1000;
      draw(Math.min(t, total));
      onProgress?.(Math.min(1, t / total));
      if (t >= total) resolve();
      else if (document.hidden) setTimeout(tick, 1000 / fps);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }).catch((e) => {
    if (rec.state !== 'inactive') rec.stop();
    stream.getTracks().forEach((tr) => tr.stop());
    throw e;
  });
  // poslední snímek ještě chvíli podržíme, ať se zapíše
  await new Promise((r) => setTimeout(r, 120));
  rec.stop();
  await done;
  stream.getTracks().forEach((tr) => tr.stop());
  const type = mime.split(';')[0] ?? 'video/webm';
  const blob = new Blob(chunks, { type });
  if (!blob.size) throw new Error('Video se nepodařilo vytvořit (prázdný záznam).');
  onProgress?.(1);
  return { blob, mime: type };
}
