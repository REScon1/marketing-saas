// Abstraktní ilustrace pro ukázková data (SVG jako data URI). Žádné externí soubory ani fotky.

export type ArtMotif = 'bakery' | 'fitness' | 'build';

function rnd(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function postArt(seed: string, color: string, motif: ArtMotif): string {
  const r = rnd(seed);
  const dark = shade(color, -0.45);
  const light = shade(color, 0.55);
  const pale = shade(color, 0.82);
  const shapes: string[] = [];
  if (motif === 'bakery') {
    for (let i = 0; i < 5; i++) {
      const cx = 150 + r() * 900, cy = 300 + r() * 500, rx = 140 + r() * 160, ry = rx * (0.5 + r() * 0.2), rot = -25 + r() * 50;
      const fill = [color, light, shade(color, 0.25), dark][i % 4];
      shapes.push(`<ellipse cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="${rx.toFixed(0)}" ry="${ry.toFixed(0)}" fill="${fill}" transform="rotate(${rot.toFixed(0)} ${cx.toFixed(0)} ${cy.toFixed(0)})"/>`);
      for (let k = -1; k <= 1; k++) {
        shapes.push(`<path d="M${(cx + k * rx * 0.35 - 30).toFixed(0)} ${(cy - ry * 0.3).toFixed(0)} q30 ${(ry * 0.3).toFixed(0)} 60 ${(ry * 0.6).toFixed(0)}" stroke="${pale}" stroke-width="10" stroke-linecap="round" fill="none" opacity=".55" transform="rotate(${rot.toFixed(0)} ${cx.toFixed(0)} ${cy.toFixed(0)})"/>`);
      }
    }
  } else if (motif === 'fitness') {
    for (let i = 0; i < 7; i++) {
      const x = -100 + i * 200 + r() * 60, w = 70 + r() * 60;
      shapes.push(`<rect x="${x.toFixed(0)}" y="-200" width="${w.toFixed(0)}" height="1400" rx="${(w / 2).toFixed(0)}" fill="${i % 2 ? light : color}" opacity="${(0.55 + r() * 0.4).toFixed(2)}" transform="rotate(28 600 450)"/>`);
    }
    shapes.push(`<circle cx="${(300 + r() * 600).toFixed(0)}" cy="${(250 + r() * 350).toFixed(0)}" r="${(110 + r() * 80).toFixed(0)}" fill="${pale}" opacity=".9"/>`);
  } else {
    let x = 80;
    while (x < 1120) {
      const w = 120 + r() * 160, h = 220 + r() * 480;
      shapes.push(`<rect x="${x.toFixed(0)}" y="${(900 - h).toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" fill="${r() > 0.5 ? color : dark}"/>`);
      for (let yy = 900 - h + 30; yy < 860; yy += 60) {
        for (let xx = x + 22; xx < x + w - 30; xx += 46) {
          if (r() > 0.35) shapes.push(`<rect x="${xx.toFixed(0)}" y="${yy.toFixed(0)}" width="22" height="30" fill="${pale}" opacity=".75"/>`);
        }
      }
      x += w + 18;
    }
    shapes.push(`<line x1="${(200 + r() * 700).toFixed(0)}" y1="60" x2="${(200 + r() * 700).toFixed(0)}" y2="420" stroke="${dark}" stroke-width="14"/>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pale}"/><stop offset="1" stop-color="${light}"/></linearGradient></defs><rect width="1200" height="900" fill="url(#g)"/>${shapes.join('')}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
