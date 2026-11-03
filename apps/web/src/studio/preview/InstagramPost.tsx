import { Bookmark, Heart, MessageCircle, MoreHorizontal, Send } from 'lucide-react';
import { useState } from 'react';
import { BrandAvatar, Caption, Carousel, Dots, MediaSlide, aspectOf, fakeCount, fmtCount, fmtDate, handleFor, slideCount, type PreviewProps } from './common';

const LIKERS = ['jana.novakova', 'petr_svoboda', 'klara.dvorakova', 'tomas.cerny', 'lucie_prochazkova'];

/** Instagram příspěvek ve feedu (obrázek i karusel). */
export function InstagramPost(p: PreviewProps & { location?: string }) {
  const { brand, design, media, caption, scheduledAt, playing, compact } = p;
  const handle = handleFor(brand, p.handle);
  const [idx, setIdx] = useState(0);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const n = Math.max(1, slideCount(design, media));
  const likes = fakeCount(brand.name + caption.length, 84, 1840) + (liked ? 1 : 0);
  const liker = LIKERS[fakeCount(brand.name, 0, LIKERS.length - 1)]!;
  const ic = compact ? 20 : 24;
  return (
    <article className={`sp sp-ig ${compact ? 'compact' : ''}`} aria-label={`Náhled příspěvku na Instagramu – @${handle}`}>
      <header className="sp-ig-head">
        <BrandAvatar brand={brand} size={compact ? 28 : 32} ring />
        <div className="sp-ig-who">
          <b>{handle}</b>
          {(p.sponsored || p.location) && <span>{p.sponsored ? 'Sponzorováno' : p.location}</span>}
        </div>
        <MoreHorizontal size={20} className="sp-ig-more" aria-hidden />
      </header>
      <Carousel count={n} index={idx} onIndex={setIdx} aspect={aspectOf(design)} counter label="Příspěvek">
        {(i) => <MediaSlide design={design} media={media} brand={brand} index={i} playing={playing && i === idx} />}
      </Carousel>
      <div className="sp-ig-actions">
        <button type="button" className={`sp-ico ${liked ? 'liked' : ''}`} onClick={() => setLiked((v) => !v)} aria-label="To se mi líbí" aria-pressed={liked}>
          <Heart size={ic} fill={liked ? 'currentColor' : 'none'} />
        </button>
        <span className="sp-ico" aria-hidden>
          <MessageCircle size={ic} style={{ transform: 'scaleX(-1)' }} />
        </span>
        <span className="sp-ico" aria-hidden>
          <Send size={ic} />
        </span>
        <Dots count={n} index={idx} className="ig" />
        <button type="button" className="sp-ico right" onClick={() => setSaved((v) => !v)} aria-label="Uložit" aria-pressed={saved}>
          <Bookmark size={ic} fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="sp-ig-body">
        <div className="sp-ig-likes">
          To se líbí uživateli <b>{liker}</b> a <b>dalším {fmtCount(likes)}</b>
        </div>
        {caption.trim() && <Caption text={caption} lead={<b>{handle}</b>} max={compact ? 90 : 125} />}
        <div className="sp-ig-comments">Zobrazit všechny komentáře ({fakeCount(brand.name + 'c', 4, 64)})</div>
        <time className="sp-ig-time">{fmtDate(scheduledAt).toLocaleUpperCase('cs')}</time>
      </div>
    </article>
  );
}
