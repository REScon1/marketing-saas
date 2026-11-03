import type { BrandProfile, DesignSlide, DesignSpec } from '@ms/core';
import type { Palette } from './paint';

export interface BrandLook {
  name: string;
  profile: BrandProfile;
}

export interface DrawOptions {
  design: DesignSpec;
  brand: BrandLook;
  /** Index slidu (image/carousel). U reel/story se scéna odvodí z `t`. */
  slide: number;
  /** Čas v sekundách (reel/story). U statických formátů se ignoruje. */
  t: number;
  w: number;
  h: number;
  images: Map<string, HTMLImageElement>;
  /** Kreslit segmentový progress story (výchozí true). */
  progress?: boolean;
}

/** Kontext jedné scény/slidu předaný šabloně. */
export interface Scene {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  P: Palette;
  brand: BrandLook;
  design: DesignSpec;
  slide: DesignSlide;
  i: number;
  n: number;
  isLast: boolean;
  /** CTA k vykreslení (jen na posledním slidu/scéně). */
  cta: string | null;
  img?: HTMLImageElement;
  logo?: HTMLImageElement;
  video: boolean;
  /** Lokální čas scény, null = statický snímek. */
  local: number | null;
  dur: number;
  /** Globální čas (pro plynulý pohyb pozadí přes scény). */
  t: number;
  /** Bezpečná oblast pro obsah. */
  box: { x: number; y: number; w: number; h: number };
  m: number;
  seed: number;
  fh: string;
  fb: string;
}

export type TemplateDraw = (s: Scene) => void;
