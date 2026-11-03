import { Globe, Heart, MessageSquareText, MoreHorizontal, Plus, Repeat2, Send, ThumbsUp } from 'lucide-react';
import { useState } from 'react';
import { BrandAvatar, Caption, Carousel, MediaSlide, aspectOf, fakeCount, fmtCount, relShort, slideCount, type PreviewProps } from './common';

/** LinkedIn příspěvek firemní stránky. */
export function LinkedInPost(p: PreviewProps) {
  const { brand, design, media, caption, scheduledAt, playing, compact } = p;
  const [idx, setIdx] = useState(0);
  const [liked, setLiked] = useState(false);
  const n = slideCount(design, media);
  const followers = fakeCount(brand.name + 'li', 380, 12400);
  const reactions = fakeCount(brand.name + 'lir', 18, 420) + (liked ? 1 : 0);
  const comments = fakeCount(brand.name + 'lic', 2, 46);
  const reposts = fakeCount(brand.name + 'lis', 1, 24);
  const aspect = design?.aspect === '9:16' ? '4 / 5' : aspectOf(design);
  return (
    <article className={`sp sp-li ${compact ? 'compact' : ''}`} aria-label={`Náhled příspěvku na LinkedInu – ${brand.name}`}>
      <header className="sp-li-head">
        <BrandAvatar brand={brand} size={compact ? 40 : 48} square />
        <div className="sp-li-who">
          <b>{brand.name}</b>
          <span>{fmtCount(followers)} sledujících</span>
          <span>
            {p.sponsored ? 'Propagováno' : relShort(scheduledAt)} · <Globe size={11} aria-label="Veřejné" />
          </span>
        </div>
        <span className="sp-li-follow">
          <Plus size={16} /> Sledovat
        </span>
        <MoreHorizontal size={20} aria-hidden className="sp-li-more" />
      </header>
      {caption.trim() && <Caption text={caption} max={compact ? 110 : 200} moreLabel="více" className="sp-li-text" />}
      {n > 0 && (
        <Carousel count={n} index={idx} onIndex={setIdx} aspect={aspect} counter label="Dokument">
          {(i) => <MediaSlide design={design} media={media} brand={brand} index={i} playing={playing && i === idx} />}
        </Carousel>
      )}
      <div className="sp-li-stats">
        <span className="sp-li-reacts" aria-hidden>
          <i className="r-like"><ThumbsUp size={9} fill="currentColor" strokeWidth={0} /></i>
          <i className="r-cele">
            <svg viewBox="0 0 16 16" width="9" height="9"><path d="M3 13 6 4l6 6-9 3zm6-11 1 2M13 3l-2 2m3 2-2 .5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" /></svg>
          </i>
          <i className="r-love"><Heart size={9} fill="currentColor" strokeWidth={0} /></i>
        </span>
        <span>{reactions}</span>
        <span className="push">
          {comments} komentářů · {reposts} sdílení
        </span>
      </div>
      <div className="sp-li-bar">
        <button type="button" className={liked ? 'liked' : ''} onClick={() => setLiked((v) => !v)} aria-pressed={liked}>
          <ThumbsUp size={18} fill={liked ? 'currentColor' : 'none'} /> <span>Líbí se mi</span>
        </button>
        <span><MessageSquareText size={18} /> <span>Komentovat</span></span>
        <span><Repeat2 size={18} /> <span>Sdílet dál</span></span>
        <span><Send size={18} /> <span>Odeslat</span></span>
      </div>
    </article>
  );
}
