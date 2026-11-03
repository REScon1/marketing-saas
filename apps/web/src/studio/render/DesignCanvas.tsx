import type { DesignSpec } from '@ms/core';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { drawFrame, isVideo, sceneDuration, sizeFor, totalDuration } from './engine';
import { ensureFonts } from './fonts';
import { designUrls, loadImages } from './images';
import type { BrandLook } from './types';

export interface DesignCanvasProps {
  design: DesignSpec;
  brand: BrandLook;
  /** Slide karuselu; u reel/story scéna pro plakátový snímek. */
  slide?: number;
  /** Přehrávat animaci (jen reel/story). */
  playing?: boolean;
  loop?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Segmentový progress u story (výchozí true). */
  showProgress?: boolean;
  /** Zavolá se po prvním vykreslení s načtenými fonty a obrázky. */
  onReady?: () => void;
  /** Každý snímek přehrávání: aktuální čas a celková délka (pro synchronizaci UI). */
  onTime?: (t: number, total: number) => void;
  /** Popisek pro čtečky obrazovky. */
  label?: string;
}

export const POSTER_T = 1.2;

function useReducedMotion(): boolean {
  const [rm, setRm] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const h = () => setRm(mq.matches);
    mq.addEventListener?.('change', h);
    return () => mq.removeEventListener?.('change', h);
  }, []);
  return rm;
}

/** Responzivní canvas s návrhem. Statické návrhy se kreslí jednou (až jsou vidět), reel/story se animují jen při `playing`. */
export function DesignCanvas({
  design,
  brand,
  slide = 0,
  playing = false,
  loop = true,
  className,
  style,
  showProgress = true,
  onReady,
  onTime,
  label,
}: DesignCanvasProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const images = useRef(new Map<string, HTMLImageElement>());
  const [ready, setReady] = useState(0);
  const [visible, setVisible] = useState(false);
  const [px, setPx] = useState(0);
  const reduced = useReducedMotion();
  const { w, h } = sizeFor(design.aspect);
  const video = isVideo(design);
  const tRef = useRef<number | null>(null);
  const readyFired = useRef(false);
  const latest = useRef({ design, brand, slide, showProgress, onReady, onTime });
  latest.current = { design, brand, slide, showProgress, onReady, onTime };

  const draw = useCallback(
    (t?: number) => {
      const c = canvas.current;
      if (!c || !c.width) return;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const L = latest.current;
      const tt = t ?? (isVideo(L.design) ? sceneDuration(L.design) * L.slide + POSTER_T : 0);
      ctx.setTransform(c.width / w, 0, 0, c.height / h, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawFrame(ctx, { design: L.design, brand: L.brand, slide: L.slide, t: tt, w, h, images: images.current, progress: L.showProgress });
    },
    [w, h],
  );

  // velikost podle kontejneru
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const dpr = Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
      setPx(Math.max(1, Math.round(el.clientWidth * dpr)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // viditelnost (líné kreslení + pauza mimo obrazovku)
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((e) => setVisible(e.some((x) => x.isIntersecting)), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // fonty + obrázky
  const urlKey = designUrls(design, brand.profile.logoUrl).join('|');
  const fontKey = `${brand.profile.fontHeading}|${brand.profile.fontBody}`;
  useEffect(() => {
    let alive = true;
    Promise.all([ensureFonts(brand.profile), loadImages(design, brand.profile.logoUrl)]).then(([, imgs]) => {
      if (!alive) return;
      images.current = imgs;
      setReady((r) => r + 1);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey, fontKey]);

  // fonty dorazily později (pomalá síť) → překreslit
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts?.addEventListener) return;
    const h = () => setReady((r) => r + 1);
    fonts.addEventListener('loadingdone', h);
    return () => fonts.removeEventListener('loadingdone', h);
  }, []);

  const animate = video && playing && !reduced && visible;

  // nastavení rozměru canvasu
  useEffect(() => {
    const c = canvas.current;
    if (!c || !px) return;
    const ph = Math.round((px * h) / w);
    if (c.width !== px || c.height !== ph) {
      c.width = px;
      c.height = ph;
    }
  }, [px, w, h]);

  // statické kreslení
  useEffect(() => {
    if (!px || !visible || animate) return;
    draw(tRef.current !== null && video && playing ? tRef.current : undefined);
    if (ready && !readyFired.current) {
      readyFired.current = true;
      latest.current.onReady?.();
    }
  }, [px, visible, animate, ready, design, brand, slide, showProgress, draw, video, playing]);

  // přehrávání
  useEffect(() => {
    if (!animate || !px) return;
    let raf = 0;
    const total = totalDuration(latest.current.design);
    const offset = tRef.current ?? 0;
    const start = performance.now() - offset * 1000;
    const tick = () => {
      let t = (performance.now() - start) / 1000;
      if (loop) t %= total;
      else t = Math.min(t, total);
      tRef.current = t;
      draw(t);
      latest.current.onTime?.(t, total);
      if (!readyFired.current && ready) {
        readyFired.current = true;
        latest.current.onReady?.();
      }
      if (loop || t < total) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate, px, loop, draw, ready, design]);

  // po zastavení se vrátit na plakát
  useEffect(() => {
    if (!playing) tRef.current = null;
  }, [playing]);

  return (
    <div
      ref={wrap}
      className={`dc ${className ?? ''}`}
      style={{ aspectRatio: `${w} / ${h}`, ...style }}
      role="img"
      aria-label={label ?? design.slides[slide]?.headline ?? 'Náhled grafiky'}
    >
      <canvas ref={canvas} className="dc-canvas" />
    </div>
  );
}
