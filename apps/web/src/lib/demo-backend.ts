import {
  createServices, invoke, invokePublic, isDomainError, MemoryStore, seedDemo, SimulatedMetrics, SimulatedPublisher,
  TemplateAssistant, type Actor, type Backend, type MemoryData, type SeedResult,
} from '@ms/core';

// Demo: celé jádro běží v prohlížeči nad úložištěm v paměti, uloženým do localStorage.
// Volání jdou přes stejný `invoke` a stejná oprávnění jako na serveru.

const KEY = 'ms-demo-v1';

interface Persisted {
  data: MemoryData;
  seed: SeedResult;
}

function load(): Persisted | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}

function save(p: Persisted) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* plné úložiště nebo soukromý režim: demo běží dál jen v paměti */
  }
}

export class DemoBackend implements Backend {
  private store!: MemoryStore;
  private fixed: number | null = null;
  readonly publisher = new SimulatedPublisher();
  services!: ReturnType<typeof createServices>;
  seed!: SeedResult;
  private actor: Actor | null = null;

  static async create(): Promise<DemoBackend> {
    const b = new DemoBackend();
    await b.init(load());
    return b;
  }

  private build(data?: MemoryData) {
    this.store = new MemoryStore(data, (d) => this.seed && save({ data: d, seed: this.seed }));
    this.services = createServices({
      store: this.store,
      clock: () => new Date(this.fixed ?? Date.now()),
      newId: () => crypto.randomUUID(),
      newToken: () => crypto.randomUUID().replace(/-/g, ''),
      assistant: new TemplateAssistant(),
      publisher: this.publisher,
      metrics: new SimulatedMetrics(),
    });
  }

  private async init(p: Persisted | null) {
    if (p) {
      this.build(p.data);
      this.seed = p.seed;
      return;
    }
    this.build();
    this.seed = await seedDemo(this.services, { set: (iso) => (this.fixed = iso ? Date.parse(iso) : null) });
    this.fixed = null;
    save({ data: this.store.data, seed: this.seed });
  }

  async reset() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    this.seed = undefined as unknown as SeedResult;
    await this.init(null);
  }

  async login(userId: string): Promise<Actor> {
    this.actor = await this.services.tenancy.resolveActor(userId, this.seed.agencyId);
    return this.actor;
  }

  /** Simulace: úlohy vybraného postu se stanou splatnými hned a worker je zpracuje. Ostatní posty se nedotkne. */
  async publishNow(postId: string) {
    if (!this.actor) throw new Error('Nepřihlášen');
    const now = new Date().toISOString();
    for (const j of await this.store.publishJobs.listByPost(this.actor.agencyId, postId)) {
      if (j.status === 'pending') await this.store.publishJobs.update({ ...j, runAt: now, updatedAt: now });
    }
    await this.services.publishing.runDue();
    await this.services.reports.collectMetrics(this.actor.agencyId);
  }

  async tick() {
    await this.services.publishing.runDue();
  }

  call: Backend['call'] = async (method, ...args) => {
    if (!this.actor) throw new Error('Nepřihlášen');
    // Živé členství při každém volání, stejně jako na serveru
    const actor = await this.services.tenancy.resolveActor(this.actor.userId, this.actor.agencyId);
    await delay();
    return (await invoke(this.services, actor, method, args)) as never;
  };

  callPublic: Backend['callPublic'] = async (method, ...args) => {
    await delay();
    return (await invokePublic(this.services, method, args)) as never;
  };
}

const delay = () => new Promise((r) => setTimeout(r, 60));

export { isDomainError };
