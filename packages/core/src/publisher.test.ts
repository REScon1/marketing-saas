import { describe, expect, it } from 'vitest';
import { SimulatedMetrics } from './publisher.js';

describe('SimulatedMetrics', () => {
  it('nikdy nevrací záporná čísla a interakce nepřesáhnou dosah', async () => {
    const m = new SimulatedMetrics();
    for (let i = 0; i < 500; i++) {
      for (const network of ['facebook', 'instagram', 'linkedin'] as const) {
        const r = await m.fetch({ network, externalId: `sim_${network}_${i}_${i * 7919}`, publishedAt: '2026-10-01T10:00:00Z', now: '2026-10-20T10:00:00Z' });
        expect(r.reach).toBeGreaterThanOrEqual(0);
        expect(r.engagements).toBeGreaterThanOrEqual(0);
        expect(r.clicks).toBeGreaterThanOrEqual(0);
        expect(r.engagements).toBeLessThanOrEqual(r.reach);
        expect(r.impressions).toBeGreaterThanOrEqual(r.reach);
      }
    }
  });
});
