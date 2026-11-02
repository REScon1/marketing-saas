import { conflict, notFound } from './errors.js';
import type { PostFilter, Store } from './store.js';
import type {
  Agency, ApprovalRequest, AuditEvent, Brand, Client, Comment, Membership, Post, PostMetrics,
  PublishJob, SocialAccount, User,
} from './types.js';

export interface MemoryData {
  agencies: Agency[];
  users: User[];
  memberships: Membership[];
  clients: Client[];
  brands: Brand[];
  accounts: SocialAccount[];
  posts: Post[];
  comments: Comment[];
  approvals: ApprovalRequest[];
  publishJobs: PublishJob[];
  metrics: PostMetrics[];
  audit: AuditEvent[];
}

export const emptyData = (): MemoryData => ({
  agencies: [], users: [], memberships: [], clients: [], brands: [], accounts: [], posts: [],
  comments: [], approvals: [], publishJobs: [], metrics: [], audit: [],
});

const clone = <T>(v: T): T => structuredClone(v);

/**
 * Úložiště v paměti. Transakce = snapshot a obnova při chybě (běh je jednovláknový).
 * `onCommit` se volá po každé úspěšné vnější transakci (demo ho používá pro uložení do localStorage).
 */
export class MemoryStore implements Store {
  private depth = 0;

  constructor(
    public data: MemoryData = emptyData(),
    private readonly onCommit?: (data: MemoryData) => void,
  ) {}

  async tx<T>(fn: (s: Store) => Promise<T>): Promise<T> {
    if (this.depth > 0) return fn(this);
    const snapshot = clone(this.data);
    this.depth++;
    try {
      const result = await fn(this);
      this.depth--;
      this.onCommit?.(this.data);
      return result;
    } catch (e) {
      this.depth--;
      this.data = snapshot;
      throw e;
    }
  }

  private commitIfOutside() {
    if (this.depth === 0) this.onCommit?.(this.data);
  }

  private insertInto<T extends { id: string }>(list: T[], item: T) {
    if (list.some((x) => x.id === item.id)) throw conflict(`Záznam ${item.id} už existuje`);
    list.push(clone(item));
    this.commitIfOutside();
  }

  private replaceIn<T extends { id: string; agencyId?: string }>(list: T[], item: T, what: string) {
    const i = list.findIndex((x) => x.id === item.id && x.agencyId === item.agencyId);
    if (i < 0) throw notFound(what);
    list[i] = clone(item);
    this.commitIfOutside();
  }

  agencies = {
    get: async (id: string) => clone(this.data.agencies.find((a) => a.id === id) ?? null),
    getBySlug: async (slug: string) => clone(this.data.agencies.find((a) => a.slug === slug) ?? null),
    insert: async (a: Agency) => {
      if (this.data.agencies.some((x) => x.slug === a.slug)) throw conflict('Slug agentury je obsazený');
      this.insertInto(this.data.agencies, a);
    },
  };

  users = {
    get: async (id: string) => clone(this.data.users.find((u) => u.id === id) ?? null),
    getByEmail: async (email: string) =>
      clone(this.data.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null),
    insert: async (u: User) => {
      if (this.data.users.some((x) => x.email.toLowerCase() === u.email.toLowerCase())) {
        throw conflict('E-mail už je registrovaný');
      }
      this.insertInto(this.data.users, u);
    },
  };

  memberships = {
    listByUser: async (userId: string) => clone(this.data.memberships.filter((m) => m.userId === userId)),
    listByAgency: async (agencyId: string) => clone(this.data.memberships.filter((m) => m.agencyId === agencyId)),
    insert: async (m: Membership) => {
      if (this.data.memberships.some((x) => x.agencyId === m.agencyId && x.userId === m.userId)) {
        throw conflict('Uživatel už je členem agentury');
      }
      this.insertInto(this.data.memberships, m);
    },
    delete: async (agencyId: string, id: string) => {
      const before = this.data.memberships.length;
      this.data.memberships = this.data.memberships.filter((m) => !(m.agencyId === agencyId && m.id === id));
      if (this.data.memberships.length === before) throw notFound('Členství');
      this.commitIfOutside();
    },
  };

  clients = {
    get: async (agencyId: string, id: string) =>
      clone(this.data.clients.find((c) => c.agencyId === agencyId && c.id === id) ?? null),
    list: async (agencyId: string) =>
      clone(this.data.clients.filter((c) => c.agencyId === agencyId).sort((a, b) => a.name.localeCompare(b.name, 'cs'))),
    insert: async (c: Client) => this.insertInto(this.data.clients, c),
    update: async (c: Client) => this.replaceIn(this.data.clients, c, 'Klient'),
  };

  brands = {
    get: async (agencyId: string, id: string) =>
      clone(this.data.brands.find((b) => b.agencyId === agencyId && b.id === id) ?? null),
    list: async (agencyId: string, filter: { clientId?: string } = {}) =>
      clone(
        this.data.brands
          .filter((b) => b.agencyId === agencyId && (!filter.clientId || b.clientId === filter.clientId))
          .sort((a, b) => a.name.localeCompare(b.name, 'cs')),
      ),
    insert: async (b: Brand) => this.insertInto(this.data.brands, b),
    update: async (b: Brand) => this.replaceIn(this.data.brands, b, 'Značka'),
  };

  accounts = {
    get: async (agencyId: string, id: string) =>
      clone(this.data.accounts.find((a) => a.agencyId === agencyId && a.id === id) ?? null),
    list: async (agencyId: string, filter: { brandId?: string } = {}) =>
      clone(this.data.accounts.filter((a) => a.agencyId === agencyId && (!filter.brandId || a.brandId === filter.brandId))),
    insert: async (a: SocialAccount) => {
      if (this.data.accounts.some((x) => x.agencyId === a.agencyId && x.brandId === a.brandId && x.network === a.network)) {
        throw conflict('Značka už má účet na této síti');
      }
      this.insertInto(this.data.accounts, a);
    },
    update: async (a: SocialAccount) => this.replaceIn(this.data.accounts, a, 'Účet'),
  };

  posts = {
    get: async (agencyId: string, id: string) =>
      clone(this.data.posts.find((p) => p.agencyId === agencyId && p.id === id) ?? null),
    list: async (agencyId: string, f: PostFilter = {}) =>
      clone(
        this.data.posts
          .filter(
            (p) =>
              p.agencyId === agencyId &&
              (!f.brandId || p.brandId === f.brandId) &&
              (!f.clientId || p.clientId === f.clientId) &&
              (!f.status || f.status.includes(p.status)) &&
              (!f.from || (p.scheduledAt !== null && p.scheduledAt >= f.from)) &&
              (!f.to || (p.scheduledAt !== null && p.scheduledAt < f.to)),
          )
          .sort(comparePosts),
      ),
    insert: async (p: Post) => this.insertInto(this.data.posts, p),
    update: async (p: Post, expectedUpdatedAt: string) => {
      const cur = this.data.posts.find((x) => x.id === p.id && x.agencyId === p.agencyId);
      if (!cur) throw notFound('Post');
      if (cur.updatedAt !== expectedUpdatedAt) throw conflict('Post mezitím upravil někdo jiný');
      this.replaceIn(this.data.posts, p, 'Post');
    },
  };

  comments = {
    list: async (agencyId: string, postId: string) =>
      clone(
        this.data.comments
          .filter((c) => c.agencyId === agencyId && c.postId === postId)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      ),
    insert: async (c: Comment) => this.insertInto(this.data.comments, c),
  };

  approvals = {
    getByToken: async (token: string) => clone(this.data.approvals.find((a) => a.token === token) ?? null),
    listByPost: async (agencyId: string, postId: string) =>
      clone(
        this.data.approvals
          .filter((a) => a.agencyId === agencyId && a.postId === postId)
          .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt)),
      ),
    listPending: async (agencyId: string) =>
      clone(this.data.approvals.filter((a) => a.agencyId === agencyId && a.status === 'pending')),
    insert: async (a: ApprovalRequest) => {
      if (this.data.approvals.some((x) => x.token === a.token)) throw conflict('Token už existuje');
      this.insertInto(this.data.approvals, a);
    },
    update: async (a: ApprovalRequest) => this.replaceIn(this.data.approvals, a, 'Žádost o schválení'),
  };

  publishJobs = {
    get: async (agencyId: string, id: string) =>
      clone(this.data.publishJobs.find((j) => j.agencyId === agencyId && j.id === id) ?? null),
    listByPost: async (agencyId: string, postId: string) =>
      clone(this.data.publishJobs.filter((j) => j.agencyId === agencyId && j.postId === postId)),
    claimDue: async (now: string, lockUntil: string, limit: number) => {
      const due = this.data.publishJobs
        .filter((j) => j.status === 'pending' && j.runAt <= now && (!j.lockedUntil || j.lockedUntil < now))
        .sort((a, b) => a.runAt.localeCompare(b.runAt))
        .slice(0, limit);
      for (const j of due) {
        j.status = 'running';
        j.lockedUntil = lockUntil;
        j.attempts += 1;
        j.updatedAt = now;
      }
      if (due.length) this.commitIfOutside();
      return clone(due);
    },
    listUnknown: async (limit: number) =>
      clone(this.data.publishJobs.filter((j) => j.status === 'unknown').sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).slice(0, limit)),
    insertIfAbsent: async (j: PublishJob) => {
      const existing = this.data.publishJobs.find((x) => x.idempotencyKey === j.idempotencyKey);
      if (existing) return clone(existing);
      this.insertInto(this.data.publishJobs, j);
      return clone(j);
    },
    update: async (j: PublishJob) => this.replaceIn(this.data.publishJobs, j, 'Úloha publikace'),
  };

  metrics = {
    upsert: async (m: PostMetrics) => {
      const i = this.data.metrics.findIndex(
        (x) => x.agencyId === m.agencyId && x.postId === m.postId && x.network === m.network,
      );
      if (i >= 0) this.data.metrics[i] = clone(m);
      else this.data.metrics.push(clone(m));
      this.commitIfOutside();
    },
    listByBrand: async (agencyId: string, brandId: string) =>
      clone(this.data.metrics.filter((m) => m.agencyId === agencyId && m.brandId === brandId)),
  };

  audit = {
    insert: async (e: AuditEvent) => this.insertInto(this.data.audit, e),
    list: async (agencyId: string, f: { entityId?: string; limit?: number } = {}) =>
      clone(
        this.data.audit
          .filter((e) => e.agencyId === agencyId && (!f.entityId || e.entityId === f.entityId))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, f.limit ?? 100),
      ),
  };
}

export function comparePosts(a: Post, b: Post): number {
  if (a.scheduledAt && b.scheduledAt && a.scheduledAt !== b.scheduledAt) return a.scheduledAt.localeCompare(b.scheduledAt);
  if (a.scheduledAt && !b.scheduledAt) return -1;
  if (!a.scheduledAt && b.scheduledAt) return 1;
  return a.createdAt.localeCompare(b.createdAt);
}
