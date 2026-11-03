// Načítání brand fontů z Google Fonts a záložní řezy pro canvas.
import type { BrandProfile, FontId } from '@ms/core';

const SERIF = new Set<string>(['Fraunces', 'Playfair Display', 'Lora']);

/** Dostupné řezy u Google Fonts (požadavek na neexistující řez vrací chybu 400). */
const WEIGHTS: Record<string, number[]> = {
  Lora: [400, 600, 700],
  Manrope: [400, 600, 700, 800],
  'Bricolage Grotesque': [400, 600, 700, 800],
};

export function isSerif(font: string): boolean {
  return SERIF.has(font);
}

/** CSS font-family zásobník s rozumnými záložními písmy (Latin Extended kvůli češtině). */
export function fontStack(font: string): string {
  const f = `"${font}"`;
  if (isSerif(font)) return `${f}, "Iowan Old Style", "Charter", Georgia, "DejaVu Serif", "Times New Roman", serif`;
  if (font === 'Unbounded' || font === 'Archivo')
    return `${f}, "Inter Display", "Inter", "Helvetica Neue", "Segoe UI", Arial, sans-serif`;
  return `${f}, "Inter", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
}

/** Sestaví canvas font string. */
export function font(family: string, size: number, weight = 400, italic = false): string {
  return `${italic ? 'italic ' : ''}${weight} ${Math.round(size * 10) / 10}px ${fontStack(family)}`;
}

function cssUrl(family: string): string {
  const weights = WEIGHTS[family] ?? [400, 600, 700, 800];
  const name = family.replace(/ /g, '+');
  if (isSerif(family)) {
    const ital = [400, 600].filter((w) => weights.includes(w));
    const spec = [...weights.map((w) => `0,${w}`), ...ital.map((w) => `1,${w}`)].join(';');
    return `https://fonts.googleapis.com/css2?family=${name}:ital,wght@${spec}&display=swap`;
  }
  return `https://fonts.googleapis.com/css2?family=${name}:wght@${weights.join(';')}&display=swap`;
}

const injected = new Set<string>();
const loading = new Map<string, Promise<void>>();

function injectFamily(family: string) {
  if (typeof document === 'undefined' || injected.has(family)) return;
  injected.add(family);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = cssUrl(family);
  link.dataset.studioFont = family;
  document.head.appendChild(link);
}

function timeout(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function loadFamily(family: string): Promise<void> {
  const hit = loading.get(family);
  if (hit) return hit;
  injectFamily(family);
  const weights = WEIGHTS[family] ?? [400, 600, 700, 800];
  const p = (async () => {
    if (typeof document === 'undefined' || !document.fonts) return;
    const probes = weights.map((w) => document.fonts.load(`${w} 40px "${family}"`, 'ŽluťoučkýKůň'));
    if (isSerif(family)) probes.push(document.fonts.load(`italic 400 40px "${family}"`, 'Ž'));
    await Promise.race([Promise.allSettled(probes), timeout(2500)]);
  })().catch(() => undefined);
  loading.set(family, p);
  return p;
}

/** Načte nadpisový a textový font značky (max ~2,5 s, pak se kreslí se záložním písmem). */
export function ensureFonts(profile: Pick<BrandProfile, 'fontHeading' | 'fontBody'>): Promise<void> {
  const fams = Array.from(new Set<FontId>([profile.fontHeading, profile.fontBody].filter(Boolean)));
  return Promise.all(fams.map(loadFamily)).then(() => undefined);
}
