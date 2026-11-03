import { Globe, Heart, MessageCircle, MoreHorizontal, Share2, ThumbsUp, X } from 'lucide-react';
import { useState } from 'react';
import { BrandAvatar, Caption, Carousel, MediaSlide, aspectOf, fakeCount, fmtCount, fmtDate, slideCount, type PreviewProps } from './common';

/** Facebook příspěvek stránky. */
export function FacebookPost(p: PreviewProps) {
  const { brand, design, media, caption, scheduledAt, playing, compact } = p;
  const [idx, setIdx] = useState(0);
  const [liked, setLiked] = useState(false);
  const n = slideCount(design, media);
  const reactions = fakeCount(brand.name + 'fb', 40, 960) + (liked ? 1 : 0);
  const comments = fakeCount(brand.name + 'fbc', 3, 88);
  const shares = fakeCount(brand.name + 'fbs', 1, 40);
  const aspect = design?.aspect === '9:16' ? '4 / 5' : aspectOf(design);
  return (
    <article className={`sp sp-fb ${compact ? 'compact' : ''}`} aria-label={`Náhled příspěvku na Facebooku – ${brand.name}`}>
      <header className="sp-fb-head">
        <BrandAvatar brand={brand} size={compact ? 36 : 40} />
        <div className="sp-fb-who">
          <b>{brand.name}</b>
          <span>
            {p.sponsored ? 'Sponzorováno' : fmtDate(scheduledAt, !!scheduledAt)} · <Globe size={12} aria-label="Veřejné" />
          </span>
        </div>
        <MoreHorizontal size={20} aria-hidden />
        <X size={20} aria-hidden />
      </header>
      {caption.trim() && <Caption text={caption} max={compact ? 120 : 220} moreLabel="Zobrazit víc" className="sp-fb-text" />}
      {n > 0 && (
        <Carousel count={n} index={idx} onIndex={setIdx} aspect={aspect} dots label="Příspěvek">
          {(i) => <MediaSlide design={design} media={media} brand={brand} index={i} playing={playing && i === idx} />}
        </Carousel>
      )}
      <div className="sp-fb-stats">
        <span className="sp-fb-reacts" aria-hidden>
          <i className="r-like"><ThumbsUp size={10} fill="currentColor" strokeWidth={0} /></i>
          <i className="r-love"><Heart size={10} fill="currentColor" strokeWidth={0} /></i>
        </span>
        <span>{fmtCount(reactions)}</span>
        <span className="push">
          {comments} komentářů · {shares} sdílení
        </span>
      </div>
      <div className="sp-fb-bar">
        <button type="button" className={liked ? 'liked' : ''} onClick={() => setLiked((v) => !v)} aria-pressed={liked}>
          <ThumbsUp size={18} fill={liked ? 'currentColor' : 'none'} /> To se mi líbí
        </button>
        <span><MessageCircle size={18} /> Komentář</span>
        <span><Share2 size={18} /> Sdílet</span>
      </div>
    </article>
  );
}
