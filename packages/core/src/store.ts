import type {
  Agency, ApprovalRequest, AuditEvent, Brand, Client, Comment, Id, IsoDate, Membership, Post,
  PostMetrics, PostStatus, PublishJob, SocialAccount, User,
} from './types.js';

/**
 * Úložiště. Všechny dotazy na data agentury vyžadují agencyId; implementace ho MUSÍ
 * použít ve filtru (Postgres navíc vynucuje RLS). Jediná výjimka je dohledání
 * schvalovacího tokenu, který agenturu teprve určuje.
 *
 * `insert` u záznamu s existujícím id vyhodí conflict; `update` přepisuje celý záznam
 * a u neexistujícího vyhodí not_found.
 */
export interface Store {
  /** Spustí fn v transakci. Vnořené volání použije stejnou transakci. */
  tx<T>(fn: (s: Store) => Promise<T>): Promise<T>;

  agencies: {
    get(id: Id): Promise<Agency | null>;
    getBySlug(slug: string): Promise<Agency | null>;
    insert(a: Agency): Promise<void>;
  };
  users: {
    get(id: Id): Promise<User | null>;
    getByEmail(email: string): Promise<User | null>;
    insert(u: User): Promise<void>;
  };
  memberships: {
    listByUser(userId: Id): Promise<Membership[]>;
    listByAgency(agencyId: Id): Promise<Membership[]>;
    insert(m: Membership): Promise<void>;
    delete(agencyId: Id, id: Id): Promise<void>;
  };
  clients: {
    get(agencyId: Id, id: Id): Promise<Client | null>;
    list(agencyId: Id): Promise<Client[]>;
    insert(c: Client): Promise<void>;
    update(c: Client): Promise<void>;
  };
  brands: {
    get(agencyId: Id, id: Id): Promise<Brand | null>;
    list(agencyId: Id, filter?: { clientId?: Id }): Promise<Brand[]>;
    insert(b: Brand): Promise<void>;
    update(b: Brand): Promise<void>;
  };
  accounts: {
    get(agencyId: Id, id: Id): Promise<SocialAccount | null>;
    list(agencyId: Id, filter?: { brandId?: Id }): Promise<SocialAccount[]>;
    insert(a: SocialAccount): Promise<void>;
    update(a: SocialAccount): Promise<void>;
  };
  posts: {
    get(agencyId: Id, id: Id): Promise<Post | null>;
    /** Řazeno podle scheduledAt (null na konec), pak createdAt. */
    list(agencyId: Id, filter?: PostFilter): Promise<Post[]>;
    insert(p: Post): Promise<void>;
    /** Optimistický zámek: uloží jen pokud uložená verze odpovídá expectedUpdatedAt. */
    update(p: Post, expectedUpdatedAt: IsoDate): Promise<void>;
  };
  comments: {
    list(agencyId: Id, postId: Id): Promise<Comment[]>;
    insert(c: Comment): Promise<void>;
  };
  approvals: {
    /** Globální dohledání podle tokenu (jediný dotaz bez agencyId). */
    getByToken(token: string): Promise<ApprovalRequest | null>;
    listByPost(agencyId: Id, postId: Id): Promise<ApprovalRequest[]>;
    listPending(agencyId: Id): Promise<ApprovalRequest[]>;
    insert(a: ApprovalRequest): Promise<void>;
    update(a: ApprovalRequest): Promise<void>;
  };
  publishJobs: {
    get(agencyId: Id, id: Id): Promise<PublishJob | null>;
    listByPost(agencyId: Id, postId: Id): Promise<PublishJob[]>;
    /**
     * Atomicky zamkne až `limit` úloh ve stavu pending s runAt <= now a lockedUntil < now (nebo null),
     * nastaví jim status running, lockedUntil a attempts+1 a vrátí je. Napříč agenturami (worker).
     */
    claimDue(now: IsoDate, lockUntil: IsoDate, limit: number): Promise<PublishJob[]>;
    /** Úlohy s neznámým výsledkem napříč agenturami (worker je musí dohledat u poskytovatele). */
    listUnknown(limit: number): Promise<PublishJob[]>;
    /** Vloží úlohu; pokud idempotencyKey existuje, nic nevloží a vrátí existující. */
    insertIfAbsent(j: PublishJob): Promise<PublishJob>;
    update(j: PublishJob): Promise<void>;
  };
  metrics: {
    upsert(m: PostMetrics): Promise<void>;
    listByBrand(agencyId: Id, brandId: Id): Promise<PostMetrics[]>;
  };
  audit: {
    insert(e: AuditEvent): Promise<void>;
    list(agencyId: Id, filter?: { entityId?: Id; limit?: number }): Promise<AuditEvent[]>;
  };
}

export interface PostFilter {
  brandId?: Id;
  clientId?: Id;
  status?: PostStatus[];
  /** Včetně. Porovnává se se scheduledAt. */
  from?: IsoDate;
  /** Vyjma. */
  to?: IsoDate;
}
