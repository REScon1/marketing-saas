import { gsap } from 'gsap';
import { Flip } from 'gsap/Flip';
import { useEffect, useLayoutEffect, useRef } from 'react';

gsap.registerPlugin(Flip);
export { Flip, gsap };

/** Uživatel si v systému vypnul animace: všechno jen „skočí“ do cílového stavu. */
export const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

type Clipped = HTMLElement & { __lr?: [number, number] };

/**
 * Klouzavá pilulka (podle referenčního videa): náběžná hrana letí rychle, zadní dobíhá pomaleji,
 * takže se pilulka při přesunu natáhne. Pilulka je kopie řady záložek v inverzních barvách,
 * oříznutá clip-pathem na aktivní položku, takže se text uvnitř přebarví bez přeblikutí.
 */
export function slidePill(pill: Clipped, target: HTMLElement | null, animate = true, axis: 'x' | 'y' = 'x') {
  if (!target) {
    gsap.set(pill, { clipPath: 'inset(50% 50% 50% 50% round 999px)' });
    pill.__lr = undefined;
    return;
  }
  const W = axis === 'x' ? pill.offsetWidth : pill.offsetHeight;
  const start = axis === 'x' ? target.offsetLeft : target.offsetTop;
  const size = axis === 'x' ? target.offsetWidth : target.offsetHeight;
  const L = start;
  const R = W - (start + size);
  const T = axis === 'x' ? target.offsetTop : target.offsetLeft;
  const B = axis === 'x' ? pill.offsetHeight - (target.offsetTop + target.offsetHeight) : pill.offsetWidth - (target.offsetLeft + target.offsetWidth);
  const clip = (l: number, r: number) =>
    axis === 'x' ? `inset(${T}px ${r}px ${B}px ${l}px round 999px)` : `inset(${l}px ${B}px ${r}px ${T}px round 999px)`;
  const prev = pill.__lr;
  pill.__lr = [L, R];
  if (pill.__o) gsap.killTweensOf(pill.__o);
  if (!animate || !prev || reduced()) {
    gsap.set(pill, { clipPath: clip(L, R) });
    return;
  }
  const right = L > prev[0];
  const o = { l: prev[0], r: prev[1] };
  pill.__o = o;
  const draw = () => { gsap.set(pill, { clipPath: clip(o.l, o.r) }); };
  gsap.to(o, { l: L, duration: right ? 0.55 : 0.36, ease: right ? 'power3.inOut' : 'power3.out', onUpdate: draw });
  gsap.to(o, { r: R, duration: right ? 0.36 : 0.55, ease: right ? 'power3.out' : 'power3.inOut', onUpdate: draw });
}
declare global {
  interface HTMLElement {
    __o?: object;
  }
}

/** Odchod ze stránky: obsah se rozmaže a zmizí, pak se teprve změní adresa. */
export function pageOut(el: HTMLElement | null, done: () => void) {
  if (!el || reduced()) return done();
  gsap.to(el, { opacity: 0, filter: 'blur(10px)', y: -6, scale: 0.995, duration: 0.24, ease: 'power2.in', onComplete: done });
}

/**
 * Příchod na stránku: nadpis se odkryje zleva, panely se odmlží a naběhnou postupně,
 * vnitřní položky (bloky kalendáře, karty, řádky) až po nich.
 */
export function pageIn(root: HTMLElement) {
  gsap.set(root, { opacity: 1, filter: 'none', y: 0, scale: 1 });
  if (reduced()) return;
  const q = (s: string) => Array.from(root.querySelectorAll<HTMLElement>(s));
  const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
  const title = q('.page-head h1');
  if (title.length) tl.fromTo(title, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.8, clearProps: 'clipPath' }, 0);
  const blocks = q('.page-head .stat, .page-head .actions, .page-head .sub, .filters, .panel, .card, .chart-panel, .upnext');
  if (blocks.length) {
    tl.fromTo(blocks, { opacity: 0, y: 16, filter: 'blur(8px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.6, stagger: 0.045, clearProps: 'filter,transform,opacity' }, 0.05);
  }
  const items = q('.need, .coming > a, .block, .top-post, .draft-item, .mini button, .table tbody tr').slice(0, 80);
  if (items.length) {
    tl.fromTo(items, { opacity: 0, y: 8, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.45, stagger: 0.012, clearProps: 'transform,opacity' }, 0.22);
  }
}

/** Spustí `pageIn`, jakmile má stránka data (jednou na stránku). */
export function useReveal(ready: boolean) {
  const done = useRef(false);
  useLayoutEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    const root = document.querySelector<HTMLElement>('main.content');
    if (root) pageIn(root);
  }, [ready]);
}

/** Číslo, které při prvním zobrazení (a při změně) naběhne od nuly. */
export function useCountUp(ref: React.RefObject<HTMLElement>, value: number | null, format: (n: number) => string) {
  const last = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || value === null) return;
    if (reduced()) {
      el.textContent = format(value);
      last.current = value;
      return;
    }
    const o = { v: last.current };
    const t = gsap.to(o, { v: value, duration: 1.1, ease: 'power3.out', onUpdate: () => { el.textContent = format(o.v); } });
    last.current = value;
    return () => {
      t.kill();
    };
  }, [value, ref, format]);
}

/** Dokreslení SVG cesty (čára grafu). Cesta musí mít pathLength="1". */
export function drawIn(paths: Element[], delay = 0) {
  if (reduced() || !paths.length) return;
  gsap.fromTo(paths, { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.2, ease: 'power3.inOut', delay, clearProps: 'strokeDasharray,strokeDashoffset' });
}
