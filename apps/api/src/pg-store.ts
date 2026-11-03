import { AsyncLocalStorage } from 'node:async_hooks';
import {
  conflict, defaultProfile, DomainError, normalizeProfile, notFound,
  type Agency, type ApprovalRequest, type AuditEvent, type Brand, type Client, type Comment, type Id, type IsoDate,
  type Membership, type Post, type PostFilter, type PostMetrics, type PublishJob, type SocialAccount, type Store, type User,
} from '@ms/core';
import type pg from 'pg';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Queryable = pg.Pool | pg.PoolClient;

// ---------- Převody řádek <-> doména ----------

/** timestamptz -> ISO (ms). Do DB ukládáme jen ms přesnost, takže převod tam a zpět je přesný. */
const iso = (v: Date | string): IsoDate => (v instanceof Date ? v : new Date(v)).toISOString();
const isoOrNull = (v: Date | string | null): IsoDate | null => (v === null || v === undefined ? null : iso(v));
const json = (v: unknown) => JSON.stringify(v);

const toAgency = (r: Row): Agency => ({ id: r.id, name: r.name, slug: r.slug, plan: r.plan, createdAt: iso(r.created_at) });
const toUser = (r: Row): User => ({ id: r.id, email: r.email, name: r.name, createdAt: iso(r.created_at) });
const toMembership = (r: Row): Membership => ({
  id: r.id, agencyId: r.agency_id, userId: r.user_id, role: r.role, clientId: r.client_id, createdAt: iso(r.created_at),
});
const toClient = (r: Row): Client => ({
  id: r.id, agencyId: r.agency_id, name: r.name, contactEmail: r.contact_email, archived: r.archived, createdAt: iso(r.created_at),
});
const toBrand = (r: Row): Brand => ({
  // Starší řádky nemají pole brand kitu (JSONB beze změny schématu): doplní se výchozí hodnoty.
  id: r.id, agencyId: r.agency_id, clientId: r.client_id, name: r.name, profile: normalizeProfile({ ...defaultProfile(), ...r.profile }),
  requiresClientApproval: r.requires_client_approval, archived: r.archived, createdAt: iso(r.created_at),
});
const toAccount = (r: Row): SocialAccount => ({
  id: r.id, agencyId: r.agency_id, brandId: r.brand_id, network: r.network, handle: r.handle, providerRef: r.provider_ref,
  status: r.status, createdAt: iso(r.created_at),
});
const toPost = (r: Row): Post => ({
  id: r.id, agencyId: r.agency_id, brandId: r.brand_id, clientId: r.client_id, title: r.title, body: r.body,
  overrides: r.overrides, networks: r.networks, media: r.media, design: r.design ?? null, status: r.status, scheduledAt: isoOrNull(r.scheduled_at),
  publishedAt: isoOrNull(r.published_at), version: r.version, versions: r.versions, aiAssisted: r.ai_assisted,
  createdBy: r.created_by, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});
const toComment = (r: Row): Comment => ({
  id: r.id, agencyId: r.agency_id, postId: r.post_id, authorId: r.author_id, authorName: r.author_name,
  authorRole: r.author_role, body: r.body, postVersion: r.post_version, createdAt: iso(r.created_at),
});
const toApproval = (r: Row): ApprovalRequest => ({
  id: r.id, agencyId: r.agency_id, postId: r.post_id, postVersion: r.post_version, token: r.token, status: r.status,
  requestedBy: r.requested_by, requestedAt: iso(r.requested_at), expiresAt: iso(r.expires_at), decidedAt: isoOrNull(r.decided_at),
  decidedByName: r.decided_by_name, decidedByUserId: r.decided_by_user_id, note: r.note,
});
const toJob = (r: Row): PublishJob => ({
  id: r.id, agencyId: r.agency_id, postId: r.post_id, postVersion: r.post_version, network: r.network, accountId: r.account_id,
  idempotencyKey: r.idempotency_key, status: r.status, attempts: r.attempts, runAt: iso(r.run_at), lockedUntil: isoOrNull(r.locked_until),
  externalId: r.external_id, externalUrl: r.external_url, lastError: r.last_error, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});
const toMetrics = (r: Row): PostMetrics => ({
  agencyId: r.agency_id, postId: r.post_id, brandId: r.brand_id, network: r.network, reach: r.reach, impressions: r.impressions,
  engagements: r.engagements, clicks: r.clicks, collectedAt: iso(r.collected_at),
});
const toAudit = (r: Row): AuditEvent => ({
  id: r.id, agencyId: r.agency_id, actorId: r.actor_id, actorName: r.actor_name, action: r.action, entity: r.entity,
  entityId: r.entity_id, data: r.data, createdAt: iso(r.created_at),
});

// ---------- Chyby Postgresu -> DomainError ----------

const CONSTRAINT_MESSAGES: Record<string, string> = {
  agencies_slug_key: 'Slug agentury je obsazený',
  users_email_lower_key: 'E-mail už je registrovaný',
  memberships_agency_user_key: 'Uživatel už je členem agentury',
  accounts_agency_brand_network_key: 'Značka už má účet na této síti',
  approvals_token_key: 'Token už existuje',
};

function mapPgError(e: unknown): unknown {
  const err = e as { code?: string; constraint?: string; message?: string };
  if (!err || typeof err.code !== 'string') return e;
  if (err.code === '23505') {
    return conflict(CONSTRAINT_MESSAGES[err.constraint ?? ''] ?? 'Záznam už existuje');
  }
  if (err.code === '23503') return new DomainError('invalid', 'Odkazovaný záznam neexistuje', { constraint: err.constraint });
  // 23514 check, 23502 not null, třída 22 = neplatná data (formát data, čísla, …)
  if (err.code === '23514' || err.code === '23502' || err.code.startsWith('22')) {
    return new DomainError('invalid', 'Neplatná data', { constraint: err.constraint });
  }
  return e;
}

/**
 * Store nad Postgresem.
 *
 * Transakce: `tx` vezme spojení z poolu a uloží ho do AsyncLocalStorage. Každý dotaz
 * (i přes vnější instanci `store`, jak to služby občas dělají) uvnitř callbacku běží na
 * stejném spojení, takže vnořené `tx` přirozeně znovupoužije běžící transakci.
 */
export class PgStore implements Store {
  private readonly als = new AsyncLocalStorage<pg.PoolClient>();

  constructor(private readonly pool: pg.Pool) {}

  private db(): Queryable {
    return this.als.getStore() ?? this.pool;
  }

  private async q(sql: string, params: unknown[] = []): Promise<Row[]> {
    try {
      return (await this.db().query(sql, params)).rows;
    } catch (e) {
      throw mapPgError(e);
    }
  }

  private async exec(sql: string, params: unknown[] = []): Promise<number> {
    try {
      return (await this.db().query(sql, params)).rowCount ?? 0;
    } catch (e) {
      throw mapPgError(e);
    }
  }

  private async one<T>(sql: string, params: unknown[], map: (r: Row) => T): Promise<T | null> {
    const rows = await this.q(sql, params);
    return rows[0] ? map(rows[0]) : null;
  }

  async tx<T>(fn: (s: Store) => Promise<T>): Promise<T> {
    if (this.als.getStore()) return fn(this);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await this.als.run(client, () => fn(this));
      await client.query('commit');
      return result;
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  agencies = {
    get: (id: Id) => this.one('select * from agencies where id = $1', [id], toAgency),
    getBySlug: (slug: string) => this.one('select * from agencies where slug = $1', [slug], toAgency),
    insert: async (a: Agency) => {
      await this.exec('insert into agencies (id, name, slug, plan, created_at) values ($1, $2, $3, $4, $5)', [
        a.id, a.name, a.slug, a.plan, a.createdAt,
      ]);
    },
  };

  users = {
    get: (id: Id) => this.one('select * from users where id = $1', [id], toUser),
    getByEmail: (email: string) => this.one('select * from users where lower(email) = lower($1)', [email], toUser),
    insert: async (u: User) => {
      await this.exec('insert into users (id, email, name, created_at) values ($1, $2, $3, $4)', [u.id, u.email, u.name, u.createdAt]);
    },
  };

  memberships = {
    listByUser: async (userId: Id) =>
      (await this.q('select * from memberships where user_id = $1 order by seq', [userId])).map(toMembership),
    listByAgency: async (agencyId: Id) =>
      (await this.q('select * from memberships where agency_id = $1 order by seq', [agencyId])).map(toMembership),
    insert: async (m: Membership) => {
      await this.exec(
        'insert into memberships (id, agency_id, user_id, role, client_id, created_at) values ($1, $2, $3, $4, $5, $6)',
        [m.id, m.agencyId, m.userId, m.role, m.clientId, m.createdAt],
      );
    },
    delete: async (agencyId: Id, id: Id) => {
      const n = await this.exec('delete from memberships where agency_id = $1 and id = $2', [agencyId, id]);
      if (n === 0) throw notFound('Členství');
    },
  };

  clients = {
    get: (agencyId: Id, id: Id) => this.one('select * from clients where agency_id = $1 and id = $2', [agencyId, id], toClient),
    list: async (agencyId: Id) =>
      (await this.q('select * from clients where agency_id = $1 order by name collate "cs-x-icu", seq', [agencyId])).map(toClient),
    insert: async (c: Client) => {
      await this.exec(
        'insert into clients (id, agency_id, name, contact_email, archived, created_at) values ($1, $2, $3, $4, $5, $6)',
        [c.id, c.agencyId, c.name, c.contactEmail, c.archived, c.createdAt],
      );
    },
    update: async (c: Client) => {
      const n = await this.exec(
        'update clients set name = $3, contact_email = $4, archived = $5, created_at = $6 where agency_id = $1 and id = $2',
        [c.agencyId, c.id, c.name, c.contactEmail, c.archived, c.createdAt],
      );
      if (n === 0) throw notFound('Klient');
    },
  };

  brands = {
    get: (agencyId: Id, id: Id) => this.one('select * from brands where agency_id = $1 and id = $2', [agencyId, id], toBrand),
    list: async (agencyId: Id, filter: { clientId?: Id } = {}) =>
      (
        await this.q(
          `select * from brands where agency_id = $1 and ($2::text is null or client_id = $2)
           order by name collate "cs-x-icu", seq`,
          [agencyId, filter.clientId ?? null],
        )
      ).map(toBrand),
    insert: async (b: Brand) => {
      await this.exec(
        `insert into brands (id, agency_id, client_id, name, profile, requires_client_approval, archived, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [b.id, b.agencyId, b.clientId, b.name, json(b.profile), b.requiresClientApproval, b.archived, b.createdAt],
      );
    },
    update: async (b: Brand) => {
      const n = await this.exec(
        `update brands set client_id = $3, name = $4, profile = $5, requires_client_approval = $6, archived = $7, created_at = $8
         where agency_id = $1 and id = $2`,
        [b.agencyId, b.id, b.clientId, b.name, json(b.profile), b.requiresClientApproval, b.archived, b.createdAt],
      );
      if (n === 0) throw notFound('Značka');
    },
  };

  accounts = {
    get: (agencyId: Id, id: Id) => this.one('select * from accounts where agency_id = $1 and id = $2', [agencyId, id], toAccount),
    list: async (agencyId: Id, filter: { brandId?: Id } = {}) =>
      (
        await this.q('select * from accounts where agency_id = $1 and ($2::text is null or brand_id = $2) order by seq', [
          agencyId, filter.brandId ?? null,
        ])
      ).map(toAccount),
    insert: async (a: SocialAccount) => {
      await this.exec(
        `insert into accounts (id, agency_id, brand_id, network, handle, provider_ref, status, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [a.id, a.agencyId, a.brandId, a.network, a.handle, a.providerRef, a.status, a.createdAt],
      );
    },
    update: async (a: SocialAccount) => {
      const n = await this.exec(
        `update accounts set brand_id = $3, network = $4, handle = $5, provider_ref = $6, status = $7, created_at = $8
         where agency_id = $1 and id = $2`,
        [a.agencyId, a.id, a.brandId, a.network, a.handle, a.providerRef, a.status, a.createdAt],
      );
      if (n === 0) throw notFound('Účet');
    },
  };

  private postParams(p: Post) {
    return [
      p.id, p.agencyId, p.brandId, p.clientId, p.title, p.body, json(p.overrides), p.networks, json(p.media), p.status,
      p.scheduledAt, p.publishedAt, p.version, json(p.versions), p.aiAssisted, p.createdBy, p.createdAt, p.updatedAt,
      p.design ? json(p.design) : null,
    ];
  }

  posts = {
    get: (agencyId: Id, id: Id) => this.one('select * from posts where agency_id = $1 and id = $2', [agencyId, id], toPost),
    list: async (agencyId: Id, f: PostFilter = {}) =>
      (
        await this.q(
          `select * from posts
           where agency_id = $1
             and ($2::text is null or brand_id = $2)
             and ($3::text is null or client_id = $3)
             and ($4::text[] is null or status = any($4))
             and ($5::timestamptz is null or scheduled_at >= $5)
             and ($6::timestamptz is null or scheduled_at < $6)
           order by scheduled_at asc nulls last, created_at asc, seq asc`,
          [agencyId, f.brandId ?? null, f.clientId ?? null, f.status ?? null, f.from ?? null, f.to ?? null],
        )
      ).map(toPost),
    insert: async (p: Post) => {
      await this.exec(
        `insert into posts (id, agency_id, brand_id, client_id, title, body, overrides, networks, media, status,
           scheduled_at, published_at, version, versions, ai_assisted, created_by, created_at, updated_at, design)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
        this.postParams(p),
      );
    },
    update: async (p: Post, expectedUpdatedAt: IsoDate) => {
      const n = await this.exec(
        `update posts set brand_id = $3, client_id = $4, title = $5, body = $6, overrides = $7, networks = $8, media = $9,
           status = $10, scheduled_at = $11, published_at = $12, version = $13, versions = $14, ai_assisted = $15,
           created_by = $16, created_at = $17, updated_at = $18, design = $19
         where id = $1 and agency_id = $2 and updated_at = $20::timestamptz`,
        [...this.postParams(p), expectedUpdatedAt],
      );
      if (n === 0) {
        const exists = await this.q('select 1 from posts where id = $1 and agency_id = $2', [p.id, p.agencyId]);
        if (!exists.length) throw notFound('Post');
        throw conflict('Post mezitím upravil někdo jiný');
      }
    },
  };

  comments = {
    list: async (agencyId: Id, postId: Id) =>
      (await this.q('select * from comments where agency_id = $1 and post_id = $2 order by created_at, seq', [agencyId, postId])).map(toComment),
    insert: async (c: Comment) => {
      await this.exec(
        `insert into comments (id, agency_id, post_id, author_id, author_name, author_role, body, post_version, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [c.id, c.agencyId, c.postId, c.authorId, c.authorName, c.authorRole, c.body, c.postVersion, c.createdAt],
      );
    },
  };

  private approvalParams(a: ApprovalRequest) {
    return [
      a.id, a.agencyId, a.postId, a.postVersion, a.token, a.status, a.requestedBy, a.requestedAt, a.expiresAt,
      a.decidedAt, a.decidedByName, a.decidedByUserId, a.note,
    ];
  }

  approvals = {
    // Jediný globální dotaz; jde přes SECURITY DEFINER funkci, aby fungoval i pod RLS.
    getByToken: (token: string) => this.one('select * from app_approval_by_token($1)', [token], toApproval),
    listByPost: async (agencyId: Id, postId: Id) =>
      (await this.q('select * from approvals where agency_id = $1 and post_id = $2 order by requested_at, seq', [agencyId, postId])).map(
        toApproval,
      ),
    listPending: async (agencyId: Id) =>
      (await this.q(`select * from approvals where agency_id = $1 and status = 'pending' order by seq`, [agencyId])).map(toApproval),
    insert: async (a: ApprovalRequest) => {
      await this.exec(
        `insert into approvals (id, agency_id, post_id, post_version, token, status, requested_by, requested_at, expires_at,
           decided_at, decided_by_name, decided_by_user_id, note)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        this.approvalParams(a),
      );
    },
    update: async (a: ApprovalRequest) => {
      const n = await this.exec(
        `update approvals set post_id = $3, post_version = $4, token = $5, status = $6, requested_by = $7, requested_at = $8,
           expires_at = $9, decided_at = $10, decided_by_name = $11, decided_by_user_id = $12, note = $13
         where id = $1 and agency_id = $2`,
        this.approvalParams(a),
      );
      if (n === 0) throw notFound('Žádost o schválení');
    },
  };

  private jobParams(j: PublishJob) {
    return [
      j.id, j.agencyId, j.postId, j.postVersion, j.network, j.accountId, j.idempotencyKey, j.status, j.attempts, j.runAt,
      j.lockedUntil, j.externalId, j.externalUrl, j.lastError, j.createdAt, j.updatedAt,
    ];
  }

  publishJobs = {
    get: (agencyId: Id, id: Id) => this.one('select * from publish_jobs where agency_id = $1 and id = $2', [agencyId, id], toJob),
    listByPost: async (agencyId: Id, postId: Id) =>
      (await this.q('select * from publish_jobs where agency_id = $1 and post_id = $2 order by seq', [agencyId, postId])).map(toJob),
    claimDue: async (now: IsoDate, lockUntil: IsoDate, limit: number) => {
      const rows = await this.q('select * from app_claim_due_jobs($1, $2, $3)', [now, lockUntil, limit]);
      return rows.sort((a, b) => a.run_at - b.run_at || Number(a.seq) - Number(b.seq)).map(toJob);
    },
    listUnknown: async (limit: number) => (await this.q('select * from app_unknown_jobs($1)', [limit])).map(toJob),
    insertIfAbsent: async (j: PublishJob) => {
      const inserted = await this.q(
        `insert into publish_jobs (id, agency_id, post_id, post_version, network, account_id, idempotency_key, status, attempts,
           run_at, locked_until, external_id, external_url, last_error, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         on conflict (idempotency_key) do nothing
         returning *`,
        this.jobParams(j),
      );
      if (inserted[0]) return toJob(inserted[0]);
      const existing = await this.one('select * from publish_jobs where idempotency_key = $1', [j.idempotencyKey], toJob);
      if (!existing) throw conflict('Úloha s tímto klíčem existuje, ale není dostupná');
      return existing;
    },
    update: async (j: PublishJob) => {
      const n = await this.exec(
        `update publish_jobs set post_id = $3, post_version = $4, network = $5, account_id = $6, idempotency_key = $7, status = $8,
           attempts = $9, run_at = $10, locked_until = $11, external_id = $12, external_url = $13, last_error = $14,
           created_at = $15, updated_at = $16
         where id = $1 and agency_id = $2`,
        this.jobParams(j),
      );
      if (n === 0) throw notFound('Úloha publikace');
    },
  };

  metrics = {
    upsert: async (m: PostMetrics) => {
      await this.exec(
        `insert into metrics (agency_id, post_id, brand_id, network, reach, impressions, engagements, clicks, collected_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (agency_id, post_id, network) do update set
           brand_id = excluded.brand_id, reach = excluded.reach, impressions = excluded.impressions,
           engagements = excluded.engagements, clicks = excluded.clicks, collected_at = excluded.collected_at`,
        [m.agencyId, m.postId, m.brandId, m.network, m.reach, m.impressions, m.engagements, m.clicks, m.collectedAt],
      );
    },
    listByBrand: async (agencyId: Id, brandId: Id) =>
      (await this.q('select * from metrics where agency_id = $1 and brand_id = $2 order by seq', [agencyId, brandId])).map(toMetrics),
  };

  audit = {
    insert: async (e: AuditEvent) => {
      await this.exec(
        `insert into audit_events (id, agency_id, actor_id, actor_name, action, entity, entity_id, data, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [e.id, e.agencyId, e.actorId, e.actorName, e.action, e.entity, e.entityId, json(e.data ?? {}), e.createdAt],
      );
    },
    list: async (agencyId: Id, f: { entityId?: Id; limit?: number } = {}) => {
      const limit = Math.min(Math.max(Math.trunc(Number(f.limit ?? 100)) || 100, 1), 1000);
      // Stejně jako MemoryStore: nejnovější první, při shodném čase v pořadí vložení.
      return (
        await this.q(
          `select * from audit_events where agency_id = $1 and ($2::text is null or entity_id = $2)
           order by created_at desc, seq asc limit $3`,
          [agencyId, f.entityId ?? null, limit],
        )
      ).map(toAudit);
    },
  };
}
