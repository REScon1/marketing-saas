/**
 * Jednoduchý rate limit v paměti procesu (pevné okno). Stačí pro MVP s jednou instancí;
 * při více instancích je potřeba sdílený limit (Redis / limit na proxy).
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** true = povoleno. */
  take(key: string): { ok: boolean; retryAfterSec: number } {
    const t = this.now();
    if (t - this.lastSweep > this.windowMs) this.sweep(t);
    let e = this.hits.get(key);
    if (!e || e.resetAt <= t) {
      e = { count: 0, resetAt: t + this.windowMs };
      this.hits.set(key, e);
    }
    e.count++;
    return { ok: e.count <= this.limit, retryAfterSec: Math.ceil((e.resetAt - t) / 1000) };
  }

  private sweep(t: number) {
    this.lastSweep = t;
    for (const [k, e] of this.hits) if (e.resetAt <= t) this.hits.delete(k);
  }
}
