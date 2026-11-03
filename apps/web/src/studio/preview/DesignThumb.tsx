import type { DesignSpec, MediaRef } from '@ms/core';
import type { CSSProperties } from 'react';
import { DesignCanvas } from '../render/DesignCanvas';
import { sizeFor } from '../render/engine';
import { BrandTile, type BrandLook } from './common';

/** Ořízne návrh do cílového poměru stran (jako object-fit: cover). ratio = výška / šířka. */
export function CoverDesign({ design, brand, ratio, slide = 0 }: { design: DesignSpec; brand: BrandLook; ratio: number; slide?: number }) {
  const { w, h } = sizeFor(design.aspect);
  const rd = h / w;
  const width = rd < ratio ? (ratio / rd) * 100 : 100;
  return (
    <div className="sp-cover" style={{ aspectRatio: `1 / ${ratio}` }}>
      <div className="sp-cover-in" style={{ width: `${width}%` }}>
        <DesignCanvas design={design} brand={brand} slide={slide} />
      </div>
    </div>
  );
}

export interface DesignThumbProps {
  design: DesignSpec | null;
  media?: MediaRef[];
  brand: BrandLook;
  /** Šířka v px (výchozí 100 % kontejneru). */
  size?: number;
  rounded?: number;
  /** Vynutit poměr stran (výška/šířka), např. 1 pro čtverec. Výchozí podle návrhu, u médií 4:5. */
  ratio?: number;
  className?: string;
  style?: CSSProperties;
}

/** Malý statický náhled (první snímek / plakát reelu), levný i pro desítky kusů. */
export function DesignThumb({ design, media, brand, size, rounded = 8, ratio, className, style }: DesignThumbProps) {
  const box: CSSProperties = { width: size ?? '100%', borderRadius: rounded, ...style };
  if (design) {
    const { w, h } = sizeFor(design.aspect);
    return (
      <div className={`sp-thumb ${className ?? ''}`} style={box} title={design.slides[0]?.headline}>
        <CoverDesign design={design} brand={brand} ratio={ratio ?? h / w} />
      </div>
    );
  }
  const m = media?.find((x) => x.kind === 'image') ?? media?.[0];
  return (
    <div className={`sp-thumb ${className ?? ''}`} style={{ ...box, aspectRatio: `1 / ${ratio ?? 1.25}` }}>
      {m?.kind === 'image' ? (
        <img src={m.url} alt={m.alt} loading="lazy" className="sp-media" />
      ) : m?.kind === 'video' ? (
        <video src={m.url} muted playsInline preload="metadata" className="sp-media" />
      ) : (
        <BrandTile brand={brand} />
      )}
    </div>
  );
}
