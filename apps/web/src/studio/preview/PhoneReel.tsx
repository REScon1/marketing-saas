import { Bookmark, Camera, Heart, MessageCircle, MoreHorizontal, Music2, Plus, Send, Share2, X } from 'lucide-react';
import { useCallback, useRef } from 'react';
import { DesignCanvas } from '../render/DesignCanvas';
import { sceneDuration } from '../render/engine';
import { BrandAvatar, Caption, MediaSlide, fakeCount, fmtCount, handleFor, relShort, type PreviewProps } from './common';

export type PhoneVariant = 'reels' | 'tiktok' | 'story';

export interface PhoneReelProps extends PreviewProps {
  variant?: PhoneVariant;
}

function StatusBar() {
  return (
    <div className="sp-status" aria-hidden>
      <span>9:41</span>
      <span className="sp-status-r">
        <svg viewBox="0 0 18 12" width="17" height="11">
          <rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="currentColor" />
          <rect x="10" y="3" width="3" height="9" rx="1" fill="currentColor" />
          <rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor" />
        </svg>
        <svg viewBox="0 0 16 12" width="15" height="11">
          <path d="M8 2.2c2.3 0 4.4.9 6 2.4l1.2-1.3A10.3 10.3 0 0 0 8 .4 10.3 10.3 0 0 0 .8 3.3L2 4.6a8.6 8.6 0 0 1 6-2.4zm0 3.6c1.3 0 2.6.5 3.5 1.4l1.3-1.3A6.7 6.7 0 0 0 8 4a6.7 6.7 0 0 0-4.8 1.9l1.3 1.3c.9-.9 2.2-1.4 3.5-1.4zm0 3.6c-.6 0-1.1.2-1.5.6L8 11.6l1.5-1.6c-.4-.4-.9-.6-1.5-.6z" fill="currentColor" />
        </svg>
        <svg viewBox="0 0 27 12" width="25" height="11">
          <rect x=".5" y=".5" width="22" height="11" rx="3.2" fill="none" stroke="currentColor" opacity=".45" />
          <rect x="2" y="2" width="17" height="8" rx="2" fill="currentColor" />
          <path d="M24.5 4v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2z" fill="currentColor" opacity=".5" />
        </svg>
      </span>
    </div>
  );
}

/** Telefon s Reels / TikTok / Story chromem a přehrávaným návrhem. */
export function PhoneReel(p: PhoneReelProps) {
  const { brand, design, media, caption, playing = true, compact } = p;
  const variant = p.variant ?? (design?.format === 'story' ? 'story' : 'reels');
  const handle = handleFor(brand, p.handle);
  const segs = useRef<HTMLDivElement>(null);
  const n = Math.max(1, design?.slides.length ?? 1);
  const onTime = useCallback(
    (t: number) => {
      const el = segs.current;
      if (!el || !design) return;
      const d = sceneDuration(design);
      const kids = el.children;
      for (let i = 0; i < kids.length; i++) {
        const f = Math.max(0, Math.min(1, (t - i * d) / d));
        (kids[i]!.firstElementChild as HTMLElement | null)?.style.setProperty('transform', `scaleX(${f})`);
      }
    },
    [design],
  );
  const likes = fakeCount(brand.name + 'r', 320, 18400);
  const comments = fakeCount(brand.name + 'k', 12, 420);
  const shares = fakeCount(brand.name + 's', 8, 260);

  return (
    <div className={`sp-phone ${compact ? 'compact' : ''}`} aria-label={`Náhled ${variant === 'story' ? 'story' : variant === 'tiktok' ? 'TikTok videa' : 'reelu'} – @${handle}`} role="figure">
      <div className={`sp-screen v-${variant}`}>
        <div className="sp-video">
          {design ? (
            <DesignCanvas design={design} brand={brand} playing={playing} showProgress={false} onTime={onTime} className="sp-fill" />
          ) : (
            <MediaSlide design={null} media={media} brand={brand} index={0} playing={playing} />
          )}
        </div>
        <div className="sp-shade top" />
        <div className="sp-shade bottom" />
        <StatusBar />

        {variant === 'story' && (
          <>
            <div className="sp-story-segs" ref={segs} aria-hidden>
              {Array.from({ length: n }, (_, i) => (
                <div key={i}>
                  <i style={{ transform: playing ? 'scaleX(0)' : i === 0 ? 'scaleX(.4)' : 'scaleX(0)' }} />
                </div>
              ))}
            </div>
            <div className="sp-story-head">
              <BrandAvatar brand={brand} size={30} />
              <b>{handle}</b>
              <span>{relShort(p.scheduledAt)}</span>
              <MoreHorizontal size={20} className="push" aria-hidden />
              <X size={22} aria-hidden />
            </div>
            <div className="sp-story-reply" aria-hidden>
              <span className="sp-story-input">Odpovědět na story…</span>
              <Heart size={24} />
              <Send size={24} />
            </div>
          </>
        )}

        {variant === 'reels' && (
          <>
            <div className="sp-reels-top" aria-hidden>
              <b>Reels</b>
              <Camera size={22} />
            </div>
            <div className="sp-rail" aria-hidden>
              <span><Heart size={26} />{fmtCount(likes)}</span>
              <span><MessageCircle size={26} style={{ transform: 'scaleX(-1)' }} />{fmtCount(comments)}</span>
              <span><Send size={25} />{fmtCount(shares)}</span>
              <span><MoreHorizontal size={24} /></span>
              <span className="sp-audio-thumb"><BrandAvatar brand={brand} size={26} square /></span>
            </div>
            <div className="sp-reel-meta">
              <div className="sp-reel-who">
                <BrandAvatar brand={brand} size={30} />
                <b>{handle}</b>
                <span className="sp-follow">Sledovat</span>
              </div>
              {caption.trim() && <Caption text={caption} max={compact ? 40 : 60} className="sp-reel-cap" />}
              <div className="sp-audio">
                <Music2 size={13} />
                <div className="sp-marquee"><span>{handle} · Originální zvuk &nbsp;&nbsp;&nbsp; {handle} · Originální zvuk</span></div>
              </div>
            </div>
          </>
        )}

        {variant === 'tiktok' && (
          <>
            <div className="sp-tt-top" aria-hidden>
              <span>Sledování</span>
              <b>Pro vás</b>
            </div>
            <div className="sp-rail tt" aria-hidden>
              <span className="sp-tt-av">
                <BrandAvatar brand={brand} size={40} />
                <i><Plus size={12} strokeWidth={3} /></i>
              </span>
              <span><Heart size={30} fill="currentColor" />{fmtCount(likes)}</span>
              <span><MessageCircle size={29} fill="currentColor" />{fmtCount(comments)}</span>
              <span><Bookmark size={28} fill="currentColor" />{fmtCount(Math.round(likes / 9))}</span>
              <span><Share2 size={27} />{fmtCount(shares)}</span>
              <span className="sp-disc"><BrandAvatar brand={brand} size={24} /></span>
            </div>
            <div className="sp-reel-meta tt">
              <b className="sp-tt-handle">@{handle}</b>
              {caption.trim() && <Caption text={caption} max={compact ? 40 : 70} className="sp-reel-cap" />}
              <div className="sp-audio">
                <Music2 size={13} />
                <div className="sp-marquee"><span>Originální zvuk – {handle} &nbsp;&nbsp;&nbsp; Originální zvuk – {handle}</span></div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
