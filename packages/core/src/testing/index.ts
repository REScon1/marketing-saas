import { TemplateAssistant } from '../assistant.js';
import { MemoryStore } from '../memory-store.js';
import { SimulatedMetrics, SimulatedPublisher } from '../publisher.js';
import { createServices } from '../services.js';
import type { Store } from '../store.js';

export { storeContract } from './store-contract.js';

/** Řiditelné hodiny pro testy a seed. */
export class TestClock {
  constructor(public t = Date.parse('2026-11-02T09:00:00Z')) {}
  now = () => new Date(this.t);
  set(iso: string) {
    this.t = Date.parse(iso);
  }
  advance(ms: number) {
    this.t += ms;
  }
}

let seq = 0;
export const seqId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

export function makeTestApp(opts: { store?: Store; clock?: TestClock } = {}) {
  const clock = opts.clock ?? new TestClock();
  const publisher = new SimulatedPublisher();
  const store = opts.store ?? new MemoryStore();
  const services = createServices({
    store,
    clock: clock.now,
    newId: () => crypto.randomUUID(),
    newToken: () => crypto.randomUUID().replace(/-/g, ''),
    assistant: new TemplateAssistant(),
    publisher,
    metrics: new SimulatedMetrics(),
  });
  return { services, clock, publisher, store };
}
