import type { DesignSpec, MediaRef, PostStatus } from '@ms/core';
import { Clapperboard, Copy, Grid3x3, GripVertical, Link2, Play, SquareUser } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { fontStack } from '../render/fonts';
import { paletteFor } from '../render/paint';
import { BrandAvatar, BrandTile, fmtCount, handleFor, type BrandLook } from './common';
import { CoverDesign } from './DesignThumb';

export interface FeedGridPost {
  id: string;
  design: DesignSpec | null;
  media: MediaRef[];
  status: PostStatus;
  publishedAt: string | null;
  scheduledAt: string | null;
}

export interface FeedGridProps {
  brand: BrandLook;
  /** Seřazené od nejnovějšího. */
  posts: FeedGridPost[];
  stats?: { posts: number; followers: number; following: number };
  onOpen?(id: string): void;
  /** Jen nepublikované dlaždice lze přetáhnout; id v novém pořadí zobrazení. */
  onReorder?(ids: string[]): void;
  handle?: string;
  bio?: string;
}

const short = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric' });

function badge(p: FeedGridPost): { label: string; tone: string } | null {
  switch (p.status) {
    case 'published':
      return null;
    case 'draft':
      return { label: 'Koncept', tone: 'draft' };
    case 'in_review':
      return { label: 'Čeká na klienta', tone: 'wait' };
    case 'changes_requested':
      return { label: 'Požadované úpravy', tone: 'bad' };
    case 'approved':
      return { label: 'Schváleno', tone: 'appr' };
    case 'scheduled':
      return { label: `Naplánováno${p.scheduledAt ? ` · ${short.format(new Date(p.scheduledAt))}` : ''}`, tone: 'sched' };
    case 'publishing':
      return { label: 'Publikuje se', tone: 'sched' };
    case 'failed':
      return { label: 'Chyba publikace', tone: 'bad' };
    default:
      return { label: 'Koncept', tone: 'draft' };
  }
}

/** Mockup Instagram profilu se mřížkou 3 × 4:5 a přetahováním nepublikovaných postů. */
export function FeedGrid({ brand, posts, stats, onOpen, onReorder, handle, bio }: FeedGridProps) {
  const h = handleFor(brand, handle);
  const P = paletteFor(brand.profile);
  const [order, setOrder] = useState(() => posts.map((p) => p.id));
  const byId = useMemo(() => new Map(posts.map((p) => [p.id, p])), [posts]);
  const dragging = useRef<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const postKey = posts.map((p) => p.id).join('|');
  useEffect(() => setOrder(posts.map((p) => p.id)), [postKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const movable = (id: string) => byId.get(id)?.status !== 'published';
  const move = (from: string, to: string) => {
    if (from === to || !movable(to)) return;
    setOrder((o) => {
      const next = o.filter((x) => x !== from);
      const at = o.indexOf(to);
      next.splice(at, 0, from);
      return next;
    });
  };
  const commit = (o: string[]) => onReorder?.(o);

  const onDragStart = (e: DragEvent, id: string) => {
    dragging.current = id;
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };
  const onDragOver = (e: DragEvent, id: string) => {
    if (!dragging.current || !movable(id)) return;
    e.preventDefault();
    move(dragging.current, id);
  };
  const onDragEnd = () => {
    if (dragging.current) commit(order);
    dragging.current = null;
    setDragId(null);
  };
  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key === 'Enter') {
      onOpen?.(id);
      return;
    }
    if (!e.altKey || !movable(id) || !onReorder) return;
    const i = order.indexOf(id);
    const delta = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' ? -3 : e.key === 'ArrowDown' ? 3 : 0;
    const j = i + delta;
    if (!delta || j < 0 || j >= order.length || !movable(order[j]!)) return;
    e.preventDefault();
    const next = [...order];
    next.splice(i, 1);
    next.splice(j, 0, id);
    setOrder(next);
    commit(next);
    requestAnimationFrame(() => (document.querySelector(`[data-tile="${CSS.escape(id)}"]`) as HTMLElement | null)?.focus());
  };

  const highlights = (brand.profile.pillars ?? []).slice(0, 5);
  const bioText = bio ?? (brand.profile.pillars?.length ? brand.profile.pillars.slice(0, 3).join(' · ') : brand.profile.audience);
  const web = brand.profile.website?.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  const st = stats ?? { posts: posts.length, followers: 1280, following: 210 };

  return (
    <section className="sp sp-feed" aria-label={`Náhled Instagram profilu @${h}`}>
      <div className="sp-feed-title">
        <b>{h}</b>
      </div>
      <header className="sp-feed-head">
        <BrandAvatar brand={brand} size={80} ring />
        <ul className="sp-feed-stats">
          <li><b>{fmtCount(st.posts)}</b><span>příspěvků</span></li>
          <li><b>{fmtCount(st.followers)}</b><span>sledujících</span></li>
          <li><b>{fmtCount(st.following)}</b><span>sledovaných</span></li>
        </ul>
      </header>
      <div className="sp-feed-bio">
        <b>{brand.name}</b>
        {bioText && <p>{bioText}</p>}
        {web && (
          <a className="sp-link" href={brand.profile.website ?? '#'} target="_blank" rel="noreferrer">
            <Link2 size={13} /> {web}
          </a>
        )}
      </div>
      <div className="sp-feed-btns" aria-hidden>
        <span className="sp-btn primary">Sledovat</span>
        <span className="sp-btn">Zpráva</span>
      </div>
      {highlights.length > 0 && (
        <div className="sp-highlights">
          {highlights.map((t, i) => (
            <div key={t} className="sp-hl">
              <span className="sp-hl-c">
                <span
                  style={{
                    background: `radial-gradient(120% 120% at 30% 20%, ${i % 2 ? P.accent : P.primary}, ${P.deep})`,
                    color: i % 2 ? P.onAccent : P.onPrimary,
                    fontFamily: fontStack(brand.profile.fontHeading),
                  }}
                >
                  {t.trim().charAt(0).toLocaleUpperCase('cs')}
                </span>
              </span>
              <span className="sp-hl-t">{t}</span>
            </div>
          ))}
        </div>
      )}
      <nav className="sp-feed-tabs" aria-hidden>
        <span className="on"><Grid3x3 size={16} /> Příspěvky</span>
        <span><Clapperboard size={16} /> Reels</span>
        <span><SquareUser size={16} /> Označení</span>
      </nav>
      <div className="sp-grid" role="list">
        {order.map((id) => {
          const p = byId.get(id);
          if (!p) return null;
          const b = badge(p);
          const can = !!onReorder && movable(id);
          const fmt = p.design?.format;
          const multi = fmt === 'carousel' || (!p.design && p.media.length > 1);
          const vid = fmt === 'reel' || fmt === 'story' || (!p.design && p.media[0]?.kind === 'video');
          return (
            <div
              key={id}
              role="listitem"
              data-tile={id}
              tabIndex={0}
              className={`sp-tile ${b ? 'unpub' : ''} ${dragId === id ? 'dragging' : ''} ${can ? 'can-drag' : ''}`}
              draggable={can}
              onDragStart={(e) => onDragStart(e, id)}
              onDragOver={(e) => onDragOver(e, id)}
              onDrop={(e) => e.preventDefault()}
              onDragEnd={onDragEnd}
              onClick={() => onOpen?.(id)}
              onKeyDown={(e) => onKey(e, id)}
              aria-label={`${p.design?.slides[0]?.headline ?? 'Příspěvek'}${b ? ` – ${b.label}` : ''}${can ? '. Alt + šipky mění pořadí.' : ''}`}
            >
              {p.design ? (
                <CoverDesign design={p.design} brand={brand} ratio={1.25} />
              ) : p.media[0]?.kind === 'image' ? (
                <img src={p.media[0].url} alt={p.media[0].alt} loading="lazy" className="sp-media" />
              ) : (
                <BrandTile brand={brand} />
              )}
              {vid && <span className="sp-tile-ico"><Play size={16} fill="currentColor" /></span>}
              {multi && !vid && <span className="sp-tile-ico"><Copy size={16} /></span>}
              {b && <span className={`sp-badge t-${b.tone}`}>{b.label}</span>}
              {can && <span className="sp-grip" aria-hidden><GripVertical size={14} /></span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
