import type { BrandProfile, DesignSpec, MediaRef, Network } from '@ms/core';
import { Facebook, Instagram, Linkedin } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NETWORK_NAME, TikTokIcon } from './common';
import { FacebookPost } from './FacebookPost';
import { InstagramPost } from './InstagramPost';
import { LinkedInPost } from './LinkedInPost';
import { PhoneReel } from './PhoneReel';

export interface PreviewSwitcherProps {
  brand: { name: string; profile: BrandProfile };
  design: DesignSpec | null;
  captions?: Partial<Record<Network, string>>;
  /** Záložní text pro všechny sítě. */
  caption?: string;
  media?: MediaRef[];
  networks: Network[];
  scheduledAt?: string | null;
  playing?: boolean;
  /** Menší chrome pro karty v mřížce. */
  compact?: boolean;
}

export function NetworkGlyph({ network, size = 14 }: { network: string; size?: number }) {
  if (network === 'instagram') return <Instagram size={size} aria-hidden />;
  if (network === 'facebook') return <Facebook size={size} aria-hidden />;
  if (network === 'linkedin') return <Linkedin size={size} aria-hidden />;
  if (network === 'tiktok') return <TikTokIcon size={size} />;
  return null;
}

/** Přepínač sítí + správný mockup pro formát (feed / reel / story). */
export function PreviewSwitcher({ brand, design, captions, caption, media, networks, scheduledAt, playing = true, compact }: PreviewSwitcherProps) {
  const list: Network[] = networks.length ? networks : ['instagram'];
  const [net, setNet] = useState<Network>(list[0]!);
  useEffect(() => {
    if (!list.includes(net)) setNet(list[0]!);
  }, [list.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const text = captions?.[net] ?? caption ?? '';
  const common = { brand, design, media, caption: text, scheduledAt, playing, compact };
  const fmt = design?.format;
  const video = fmt === 'reel' || fmt === 'story' || (!design && media?.[0]?.kind === 'video');
  const n = net as string;

  let view;
  if (n === 'tiktok') view = <PhoneReel {...common} variant="tiktok" />;
  else if (video && n !== 'linkedin') view = <PhoneReel {...common} variant={fmt === 'story' ? 'story' : 'reels'} />;
  else if (n === 'facebook') view = <FacebookPost {...common} />;
  else if (n === 'linkedin') view = <LinkedInPost {...common} />;
  else view = <InstagramPost {...common} />;

  return (
    <div className={`sp-switch ${compact ? 'compact' : ''}`}>
      {list.length > 1 && (
        <div className="sp-chips" role="tablist" aria-label="Náhled pro síť">
          {list.map((x) => (
            <button
              key={x}
              type="button"
              role="tab"
              aria-selected={x === net}
              className={`sp-chip ${x === net ? 'on' : ''}`}
              onClick={() => setNet(x)}
            >
              <NetworkGlyph network={x} size={compact ? 13 : 14} />
              {!compact && <span>{NETWORK_NAME[x] ?? x}</span>}
              {compact && <span className="sr-only">{NETWORK_NAME[x] ?? x}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="sp-stage" key={`${net}-${fmt ?? 'm'}`}>
        {view}
      </div>
    </div>
  );
}
