import type { DesignSpec, MediaRef, Network } from '@ms/core';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { DesignCanvas } from '../render/DesignCanvas';
import { fontStack } from '../render/fonts';
import { paletteFor } from '../render/paint';
import { handleOf } from '../render/templates';
import type { BrandLook } from '../render/types';
import { hashStr, initials } from '../render/util';

export type { BrandLook };

/** Společné props všech mockupů. */
export interface PreviewProps {
  brand: BrandLook;
  design: DesignSpec | null;
  media?: MediaRef[];
  caption: string;
  scheduledAt?: string | null;
  /** Handle bez @; výchozí odvozený z názvu značky. */
  handle?: string;
  playing?: boolean;
  /** Menší chrome (karty v mřížce). */
  compact?: boolean;
  /** Zobrazit „Sponzorováno“. */
  sponsored?: boolean;
}

export const handleFor = (brand: BrandLook, handle?: string) => (handle?.replace(/^@/, '') || handleOf(brand.name));

/** Deterministická „realistická“ čísla podle značky. */
export function fakeCount(seed: string, min: number, max: number): number {
  const h = hashStr(seed);
  return Math.round(min + (h % 1000) / 1000 * (max - min));
}

export function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',').replace(',0', '')} mil.`;
  if (n >= 10_000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace('.', ',').replace(',0', '')} tis.`;
  return n.toLocaleString('cs-CZ');
}

const dayMonth = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'long' });
const dayMonthTime = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export function fmtDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return withTime ? 'Právě teď' : 'před 2 hodinami';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return withTime ? dayMonthTime.format(d).replace(' v ', ' v ') : dayMonth.format(d);
}

export function relShort(iso: string | null | undefined): string {
  if (!iso) return '2 h';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 0) return dayMonth.format(d);
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))} min`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h`;
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)} d`;
  return dayMonth.format(d);
}

/** Avatar: logo značky, jinak monogram v barvách značky. */
export function BrandAvatar({ brand, size = 32, square = false, ring = false }: { brand: BrandLook; size?: number; square?: boolean; ring?: boolean }) {
  const P = paletteFor(brand.profile);
  const radius = square ? Math.round(size * 0.2) : size;
  const inner: CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    background: P.primary,
    color: P.onPrimary,
    fontFamily: fontStack(brand.profile.fontHeading),
    fontSize: size * 0.38,
  };
  const content = brand.profile.logoUrl ? (
    <span className="sp-avatar" style={{ ...inner, background: '#fff' }}>
      <img src={brand.profile.logoUrl} alt="" />
    </span>
  ) : (
    <span className="sp-avatar" style={inner}>
      {initials(brand.name).slice(0, 2)}
    </span>
  );
  if (!ring) return content;
  return (
    <span className="sp-ring" style={{ borderRadius: radius, padding: Math.max(2, size * 0.06) }}>
      <span className="sp-ring-gap" style={{ borderRadius: radius, padding: Math.max(1.5, size * 0.045) }}>
        {content}
      </span>
    </span>
  );
}

/** Popisek s #hashtagy a @zmínkami, zkrácený s „… více“. */
export function Caption({
  text,
  max = 125,
  lead,
  moreLabel = 'více',
  className,
}: {
  text: string;
  max?: number;
  lead?: ReactNode;
  moreLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const t = text.trim();
  const firstBreak = t.indexOf('\n');
  const cut = Math.min(max, firstBreak > 0 && firstBreak < max ? firstBreak : max);
  const long = t.length > cut + 4;
  const shown = open || !long ? t : t.slice(0, cut).replace(/\s+\S*$/, '').replace(/[\s.,;:–-]+$/, '');
  return (
    <div className={`sp-caption ${className ?? ''}`}>
      {lead}
      {lead ? ' ' : null}
      <RichText text={shown} />
      {long && !open && (
        <>
          {'… '}
          <button type="button" className="sp-more" onClick={() => setOpen(true)}>
            {moreLabel}
          </button>
        </>
      )}
    </div>
  );
}

export function RichText({ text }: { text: string }) {
  const parts = text.split(/(#[\p{L}\p{N}_]+|@[\w.]+|https?:\/\/\S+)/u);
  return (
    <>
      {parts.map((p, i) =>
        /^(#|@|https?:)/.test(p) ? (
          <span key={i} className="sp-link">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/** Kolik „slidů“ má média: návrh, jinak nahraná média. */
export function slideCount(design: DesignSpec | null, media: MediaRef[] | undefined): number {
  if (design) return design.format === 'carousel' ? design.slides.length : 1;
  return Math.max(0, media?.length ?? 0);
}

export function aspectOf(design: DesignSpec | null): string {
  if (!design) return '4 / 5';
  return design.aspect === '1:1' ? '1 / 1' : design.aspect === '9:16' ? '9 / 16' : '4 / 5';
}

/** Jeden snímek média: návrh (canvas) nebo nahraná fotka/video. */
export function MediaSlide({
  design,
  media,
  brand,
  index,
  playing,
  showProgress,
}: {
  design: DesignSpec | null;
  media?: MediaRef[];
  brand: BrandLook;
  index: number;
  playing?: boolean;
  showProgress?: boolean;
}) {
  if (design)
    return <DesignCanvas design={design} brand={brand} slide={index} playing={playing} showProgress={showProgress} className="sp-fill" />;
  const m = media?.[index];
  if (m?.kind === 'video')
    return <video className="sp-media" src={m.url} muted loop playsInline autoPlay={playing} aria-label={m.alt} />;
  if (m) return <img className="sp-media" src={m.url} alt={m.alt} loading="lazy" />;
  return <BrandTile brand={brand} />;
}

export function BrandTile({ brand, label }: { brand: BrandLook; label?: string }) {
  const P = paletteFor(brand.profile);
  return (
    <div
      className="sp-brandtile"
      style={{
        background: `radial-gradient(120% 90% at 20% 10%, ${P.primary}, ${P.deep})`,
        color: P.onPrimary,
        fontFamily: fontStack(brand.profile.fontHeading),
      }}
    >
      <span>{label ?? initials(brand.name)}</span>
    </div>
  );
}

/** Ovládaný karusel: tažení, šipky, klávesnice. */
export function Carousel({
  count,
  index,
  onIndex,
  aspect,
  children,
  dots = false,
  counter = false,
  label = 'Karusel',
}: {
  count: number;
  index: number;
  onIndex: (i: number) => void;
  aspect: string;
  children: (i: number) => ReactNode;
  dots?: boolean;
  counter?: boolean;
  label?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; id: number; w: number; dx: number } | null>(null);
  const go = useCallback((i: number) => onIndex(Math.max(0, Math.min(count - 1, i))), [count, onIndex]);
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (count < 2 || (e.target as HTMLElement).closest('button')) return;
    drag.current = { x: e.clientX, id: e.pointerId, w: e.currentTarget.clientWidth, dx: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !track.current) return;
    d.dx = e.clientX - d.x;
    track.current.style.transition = 'none';
    track.current.style.transform = `translateX(calc(${-index * 100}% + ${d.dx}px))`;
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !track.current) return;
    track.current.style.transition = '';
    track.current.style.transform = '';
    if (Math.abs(d.dx) > d.w * 0.18) go(index + (d.dx < 0 ? 1 : -1));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(index + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(index - 1);
    }
  };
  return (
    <div
      className="sp-carousel"
      style={{ aspectRatio: aspect }}
      tabIndex={count > 1 ? 0 : undefined}
      role={count > 1 ? 'region' : undefined}
      aria-roledescription={count > 1 ? 'karusel' : undefined}
      aria-label={count > 1 ? `${label}, snímek ${index + 1} z ${count}` : undefined}
      onKeyDown={onKey}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div ref={track} className="sp-track" style={{ transform: `translateX(${-index * 100}%)` }}>
        {Array.from({ length: Math.max(1, count) }, (_, i) => (
          <div className="sp-slide" key={i} aria-hidden={i !== index}>
            {Math.abs(i - index) <= 1 || i === 0 ? children(i) : <div className="sp-fill" />}
          </div>
        ))}
      </div>
      {count > 1 && (
        <>
          {index > 0 && (
            <button type="button" className="sp-arrow left" onClick={() => go(index - 1)} aria-label="Předchozí snímek">
              <ChevronLeft size={18} />
            </button>
          )}
          {index < count - 1 && (
            <button type="button" className="sp-arrow right" onClick={() => go(index + 1)} aria-label="Další snímek">
              <ChevronRight size={18} />
            </button>
          )}
          {counter && (
            <span className="sp-counter">
              {index + 1}/{count}
            </span>
          )}
          {dots && <Dots count={count} index={index} className="inside" />}
        </>
      )}
    </div>
  );
}

export function Dots({ count, index, className }: { count: number; index: number; className?: string }) {
  if (count < 2) return null;
  return (
    <span className={`sp-dots ${className ?? ''}`} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <i key={i} className={i === index ? 'on' : Math.abs(i - index) > 3 ? 'far' : ''} />
      ))}
    </span>
  );
}

/** Logo TikToku (lucide ho nemá). */
export function TikTokIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 0 1-2.59 2.5c-1.42 0-2.6-1.16-2.6-2.6 0-1.72 1.66-3.01 3.37-2.48V9.66c-3.45-.46-6.47 2.22-6.47 5.64 0 3.33 2.76 5.7 5.69 5.7 3.14 0 5.69-2.55 5.69-5.7V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3s-1.88.09-3.24-1.48z" />
    </svg>
  );
}

export const NETWORK_NAME: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', tiktok: 'TikTok' };

export type AnyNetwork = Network | 'tiktok';
