import { useEffect, useRef, useSyncExternalStore } from 'react';
import { gsap, reduced } from '../lib/motion';

// Rozmazaný obrázek v pozadí celé aplikace (jako fotografické pozadí v referenčním videu).
// Stránky ho nastaví přes useAmbient(url); při změně se staré a nové prolnou.

let current: string | null = null;
const listeners = new Set<() => void>();
export function setAmbient(url: string | null) {
  if (url === current) return;
  current = url;
  listeners.forEach((l) => l());
}

/** Nastaví ambientní obrázek, dokud je stránka zobrazená. */
export function useAmbient(url: string | null | undefined) {
  useEffect(() => {
    setAmbient(url ?? null);
  }, [url]);
  useEffect(() => () => setAmbient(null), []);
}

export function Ambient() {
  const url = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const old = Array.from(el.querySelectorAll('img'));
    const fadeOld = () => old.forEach((o) => (reduced() ? o.remove() : gsap.to(o, { opacity: 0, duration: 1, ease: 'power2.out', onComplete: () => o.remove() })));
    if (!url) return fadeOld();
    const img = document.createElement('img');
    img.alt = '';
    img.src = url;
    el.appendChild(img);
    if (reduced()) gsap.set(img, { opacity: 'var(--ambient-opacity)' });
    else gsap.fromTo(img, { opacity: 0, scale: 1.08 }, { opacity: getComputedStyle(el).getPropertyValue('--ambient-opacity') || 0.3, scale: 1, duration: 1.4, ease: 'power2.out' });
    fadeOld();
  }, [url]);
  return <div className="ambient" ref={box} aria-hidden />;
}
