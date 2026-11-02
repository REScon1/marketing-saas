import { textForNetwork, type MediaRef, type Network } from '@ms/core';
import { Heart, MessageCircle, Repeat2, Send, ThumbsUp } from 'lucide-react';
import { useState } from 'react';
import { NETWORK_LABEL, fmtDateTime } from '../lib/format';
import { NetworkIcon } from './ui';

interface Props {
  brandName: string;
  brandColor: string;
  title: string;
  body: string;
  overrides: Partial<Record<Network, string>>;
  networks: Network[];
  scheduledAt: string | null;
  media?: MediaRef[];
}

/** Přibližný náhled postu tak, jak ho uvidí lidé na dané síti. */
export function PostPreview(p: Props) {
  const [active, setActive] = useState<Network | null>(null);
  const net = active && p.networks.includes(active) ? active : p.networks[0];
  if (!net) return <div className="empty small">Vyberte síť, aby šel zobrazit náhled.</div>;
  const text = textForNetwork(p.body, p.overrides, net);
  const handle = p.brandName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '');
  const img = p.media?.[0];
  const media = img ? (
    <img className={`preview-img ${net === 'instagram' ? 'ig' : ''}`} src={img.url} alt={img.alt || ''} />
  ) : (
    <div className={`preview-media ${net === 'instagram' ? 'ig' : ''}`} style={{ background: `linear-gradient(135deg, ${p.brandColor}, ${p.brandColor}99)` }}>
      {p.title}
    </div>
  );
  return (
    <div>
      {p.networks.length > 1 && (
        <div className="net-tabs" role="tablist" aria-label="Náhled pro síť">
          {p.networks.map((n) => (
            <button key={n} role="tab" aria-selected={n === net} className={`chip ${n === net ? 'on' : ''}`} onClick={() => setActive(n)}>
              <NetworkIcon network={n} size={13} /> {NETWORK_LABEL[n]}
            </button>
          ))}
        </div>
      )}
      <div className="preview">
        <div className="preview-head">
          <span className="avatar" style={{ background: p.brandColor, color: '#fff' }}>{p.brandName[0]}</span>
          <div>
            <div className="who">{net === 'instagram' ? handle : p.brandName}</div>
            <div className="meta">
              {net === 'linkedin' ? 'Firemní stránka · ' : ''}
              {p.scheduledAt ? fmtDateTime(p.scheduledAt) : 'Termín zatím nenastaven'}
            </div>
          </div>
          <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}><NetworkIcon network={net} size={16} /></span>
        </div>
        {net === 'instagram' ? (
          <>
            {media}
            <div className="preview-foot" style={{ borderTop: 0 }}><Heart size={18} /><MessageCircle size={18} /><Send size={18} /></div>
            <div className="preview-body"><strong>{handle}</strong> {text || <span className="muted">Text postu…</span>}</div>
          </>
        ) : (
          <>
            <div className="preview-body">{text || <span className="muted">Text postu…</span>}</div>
            {media}
            <div className="preview-foot">
              <span className="row"><ThumbsUp size={14} /> To se mi líbí</span>
              <span className="row"><MessageCircle size={14} /> Komentář</span>
              <span className="row">{net === 'linkedin' ? <Repeat2 size={14} /> : <Send size={14} />} Sdílet</span>
            </div>
          </>
        )}
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>{[...text].length.toLocaleString('cs-CZ')} znaků · přibližný náhled</div>
    </div>
  );
}
