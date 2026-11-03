// Načítání obrázků (fotky ve slidech + logo) se sdílenou cache; chyby se tiše přeskočí.
import type { DesignSpec } from '@ms/core';

const cache = new Map<string, Promise<HTMLImageElement | null>>();

export function loadImage(url: string): Promise<HTMLImageElement | null> {
  const hit = cache.get(url);
  if (hit) return hit;
  const p = new Promise<HTMLImageElement | null>((resolve) => {
    if (typeof Image === 'undefined') return resolve(null);
    const img = new Image();
    if (/^https?:/i.test(url)) img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const timer = setTimeout(() => resolve(null), 12000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img.naturalWidth > 0 ? img : null);
    };
    img.onerror = () => {
      clearTimeout(timer);
      cache.delete(url); // dovolí pozdější nový pokus
      resolve(null);
    };
    img.src = url;
  });
  cache.set(url, p);
  return p;
}

export function designUrls(design: DesignSpec | null | undefined, logoUrl?: string | null): string[] {
  const out = new Set<string>();
  for (const s of design?.slides ?? []) if (s.mediaUrl && /^(https?:|data:|blob:|\/)/i.test(s.mediaUrl)) out.add(s.mediaUrl);
  if (logoUrl) out.add(logoUrl);
  return Array.from(out);
}

/** Načte všechny fotky návrhu (+ logo značky). Nenačtené se v mapě nevyskytují. */
export async function loadImages(design: DesignSpec, logoUrl?: string | null): Promise<Map<string, HTMLImageElement>> {
  const urls = designUrls(design, logoUrl);
  const map = new Map<string, HTMLImageElement>();
  const res = await Promise.all(urls.map((u) => loadImage(u)));
  res.forEach((img, k) => {
    if (img) map.set(urls[k]!, img);
  });
  return map;
}
