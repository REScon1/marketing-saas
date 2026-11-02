import type { MediaRef, Network } from './types.js';

export interface PublishRequest {
  idempotencyKey: string;
  network: Network;
  providerRef: string | null;
  handle: string;
  text: string;
  media: MediaRef[];
}

export type PublishResult =
  | { ok: true; externalId: string; url: string | null }
  | { ok: false; retryable: boolean; error: string };

export type LookupResult = { found: true; externalId: string; url: string | null } | { found: false };

/**
 * Publikace na sociální sítě. V produkci adaptér nad unified social API (Ayrshare apod.).
 * `publish` může vyhodit výjimku (timeout, ztracená odpověď): výsledek je pak NEZNÁMÝ
 * a před dalším pokusem se musí dohledat přes `lookup` (audit G2).
 */
export interface SocialPublisher {
  readonly label: string;
  publish(req: PublishRequest): Promise<PublishResult>;
  lookup(idempotencyKey: string, network: Network): Promise<LookupResult>;
}

export interface MetricsSample {
  reach: number;
  impressions: number;
  engagements: number;
  clicks: number;
}

export interface MetricsProvider {
  fetch(input: { network: Network; externalId: string; publishedAt: string; now: string }): Promise<MetricsSample>;
}

type Failure = 'retryable' | 'fatal' | 'lost_response';

/** Simulovaná publikace pro demo a testy. Nic se nikam neposílá. */
export class SimulatedPublisher implements SocialPublisher {
  readonly label = 'Simulace (nic se nepublikuje)';
  readonly published = new Map<string, { externalId: string; url: string; text: string; network: Network }>();
  private queue: Failure[] = [];
  private seq = 0;

  /** Další volání publish skončí danou chybou (pro testy a předvedení). */
  failNext(...f: Failure[]) {
    this.queue.push(...f);
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const f = this.queue.shift();
    if (f === 'retryable') return { ok: false, retryable: true, error: 'Síť dočasně nedostupná (simulace)' };
    if (f === 'fatal') return { ok: false, retryable: false, error: 'Token účtu vypršel (simulace)' };
    const existing = this.published.get(req.idempotencyKey);
    if (existing) return { ok: true, externalId: existing.externalId, url: existing.url };
    const externalId = `sim_${req.network}_${++this.seq}`;
    const url = `https://example.invalid/${req.network}/${req.handle.replace(/^@/, '')}/${externalId}`;
    this.published.set(req.idempotencyKey, { externalId, url, text: req.text, network: req.network });
    if (f === 'lost_response') throw new Error('Timeout: odpověď se ztratila (simulace)');
    return { ok: true, externalId, url };
  }

  async lookup(idempotencyKey: string): Promise<LookupResult> {
    const p = this.published.get(idempotencyKey);
    return p ? { found: true, externalId: p.externalId, url: p.url } : { found: false };
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministické simulované metriky: rostou s časem od publikace a liší se podle sítě. */
export class SimulatedMetrics implements MetricsProvider {
  async fetch(input: { network: Network; externalId: string; publishedAt: string; now: string }): Promise<MetricsSample> {
    const h = hash(input.externalId);
    const base = { facebook: 1800, instagram: 2600, linkedin: 900 }[input.network];
    const days = Math.max(0, (Date.parse(input.now) - Date.parse(input.publishedAt)) / 864e5);
    const growth = Math.min(1, 0.35 + days / 7);
    const reach = Math.round(base * (0.5 + (h % 1000) / 1000) * growth);
    const rate = { facebook: 0.035, instagram: 0.055, linkedin: 0.045 }[input.network] * (0.6 + ((h >>> 10) % 100) / 100);
    const engagements = Math.round(reach * rate);
    return {
      reach,
      impressions: Math.round(reach * (1.25 + ((h >>> 4) % 50) / 100)),
      engagements,
      clicks: Math.round(engagements * (0.2 + ((h >>> 16) % 30) / 100)),
    };
  }
}
