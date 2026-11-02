import {
  brandCheck, hasBlockingIssues, textForNetwork,
  type BrandIssue, type ContentAssistant, type DraftVariant,
} from './assistant.js';
import { conflict, DomainError, forbidden, invalid, notFound } from './errors.js';
import {
  assertCanDecide, assertCanSeeBrand, assertCanSeeClient, assertCanSeePost, assertOwner, assertStaff,
  canSeeBrand, canSeeClient, isStaff,
} from './policy.js';
import type { MetricsProvider, SocialPublisher } from './publisher.js';
import type { PostFilter, Store } from './store.js';
import type {
  Actor, Agency, ApprovalRequest, AuditEvent, Brand, BrandProfile, Client, Comment, Id, Language,
  MediaRef, Membership, Network, Post, PostMetrics, PostStatus, PublishJob, Role, SocialAccount, User,
} from './types.js';
import { NETWORKS, NETWORK_LIMITS } from './types.js';

export interface Deps {
  store: Store;
  clock: () => Date;
  newId: () => string;
  newToken: () => string;
  assistant: ContentAssistant;
  publisher: SocialPublisher;
  metrics: MetricsProvider;
}

export const APPROVAL_TTL_DAYS = 14;
export const MAX_PUBLISH_ATTEMPTS = 5;
const LOCK_MS = 2 * 60 * 1000;

export const defaultProfile = (): BrandProfile => ({
  tone: '',
  audience: '',
  bannedWords: [],
  examples: [],
  defaultHashtags: [],
  maxHashtags: 3,
  languages: ['cs'],
  emoji: 'few',
  color: '#3b5bdb',
});

const EDITABLE: PostStatus[] = ['draft', 'in_review', 'changes_requested', 'approved', 'scheduled', 'failed'];
const RESETS_APPROVAL: PostStatus[] = ['in_review', 'approved', 'scheduled', 'failed'];

function slugify(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 40) || 'agentura';
}

function requireText(v: unknown, field: string, max = 200): string {
  if (typeof v !== 'string' || !v.trim()) throw invalid(`Pole „${field}“ je povinné`, { field });
  if (v.length > max) throw invalid(`Pole „${field}“ je příliš dlouhé`, { field });
  return v.trim();
}

function requireEmail(v: unknown): string {
  const e = requireText(v, 'e-mail', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw invalid('Neplatný e-mail', { field: 'email' });
  return e;
}

function validNetworks(v: unknown): Network[] {
  if (!Array.isArray(v)) throw invalid('Sítě musí být seznam', { field: 'networks' });
  const out = [...new Set(v)].filter((n): n is Network => NETWORKS.includes(n as Network));
  if (out.length !== new Set(v).size) throw invalid('Neznámá síť', { field: 'networks' });
  return out;
}

export interface PostDetail {
  post: Post;
  brand: Brand;
  client: Client;
  comments: Comment[];
  approvals: ApprovalRequest[];
  jobs: PublishJob[];
  issues: BrandIssue[];
  accounts: SocialAccount[];
}

export interface PublicApprovalView {
  agencyName: string;
  brandName: string;
  brandColor: string;
  clientName: string;
  post: Pick<Post, 'id' | 'title' | 'body' | 'overrides' | 'networks' | 'media' | 'scheduledAt' | 'version'>;
  approval: Pick<ApprovalRequest, 'status' | 'expiresAt' | 'decidedAt' | 'decidedByName' | 'note' | 'postVersion'>;
  comments: Pick<Comment, 'authorName' | 'authorRole' | 'body' | 'createdAt'>[];
  isCurrent: boolean;
}

export interface MonthlyReport {
  brand: Brand;
  client: Client;
  month: string;
  periodLabel: string;
  totals: ReportTotals;
  previous: ReportTotals | null;
  byNetwork: (ReportTotals & { network: Network })[];
  daily: { date: string; reach: number; engagements: number }[];
  topPosts: { post: Post; reach: number; engagements: number; engagementRate: number }[];
  summary: string;
  summaryByAi: boolean;
}

export interface ReportTotals {
  posts: number;
  reach: number;
  impressions: number;
  engagements: number;
  clicks: number;
  engagementRate: number;
}

const MONTHS_CS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];

export function createServices(deps: Deps) {
  const { store, newId } = deps;
  const nowIso = () => deps.clock().toISOString();

  async function audit(
    s: Store, agencyId: Id, actor: { userId?: Id | null; name: string }, action: string,
    entity: AuditEvent['entity'], entityId: Id, data: Record<string, unknown> = {},
  ) {
    await s.audit.insert({
      id: newId(), agencyId, actorId: actor.userId ?? null, actorName: actor.name, action, entity, entityId, data,
      createdAt: nowIso(),
    });
  }

  async function loadPost(s: Store, actor: Actor, id: Id): Promise<Post> {
    const p = await s.posts.get(actor.agencyId, id);
    if (!p) throw notFound('Post');
    assertCanSeePost(actor, p);
    return p;
  }

  async function loadBrand(s: Store, actor: Actor, id: Id): Promise<Brand> {
    const b = await s.brands.get(actor.agencyId, id);
    if (!b) throw notFound('Značka');
    assertCanSeeBrand(actor, b);
    return b;
  }

  async function savePost(s: Store, before: Post, after: Post) {
    after.updatedAt = nowIso();
    if (after.updatedAt <= before.updatedAt) {
      // Hodiny mohou vrátit stejný čas; updatedAt je zároveň verze pro optimistický zámek.
      after.updatedAt = new Date(Date.parse(before.updatedAt) + 1).toISOString();
    }
    await s.posts.update(after, before.updatedAt);
    return after;
  }

  async function supersedePending(s: Store, post: Post) {
    for (const a of await s.approvals.listByPost(post.agencyId, post.id)) {
      if (a.status === 'pending') await s.approvals.update({ ...a, status: 'superseded' });
    }
  }

  async function cancelPendingJobs(s: Store, post: Post, reason: string) {
    for (const j of await s.publishJobs.listByPost(post.agencyId, post.id)) {
      if (j.status === 'pending') {
        await s.publishJobs.update({ ...j, status: 'cancelled', lastError: reason, updatedAt: nowIso() });
      }
    }
  }

  // =================== Identita a tenancy ===================

  const tenancy = {
    async registerAgency(input: { agencyName: string; ownerEmail: string; ownerName: string; slug?: string }) {
      const name = requireText(input.agencyName, 'název agentury');
      const email = requireEmail(input.ownerEmail);
      const ownerName = requireText(input.ownerName, 'jméno');
      return store.tx(async (s) => {
        let slug = slugify(input.slug ?? name);
        for (let i = 2; await s.agencies.getBySlug(slug); i++) slug = `${slugify(input.slug ?? name)}-${i}`;
        const agency: Agency = { id: newId(), name, slug, plan: 'pilot', createdAt: nowIso() };
        await s.agencies.insert(agency);
        let user = await s.users.getByEmail(email);
        if (!user) {
          user = { id: newId(), email, name: ownerName, createdAt: nowIso() };
          await s.users.insert(user);
        }
        const m: Membership = { id: newId(), agencyId: agency.id, userId: user.id, role: 'owner', clientId: null, createdAt: nowIso() };
        await s.memberships.insert(m);
        await audit(s, agency.id, { userId: user.id, name: user.name }, 'agency.created', 'agency', agency.id);
        return { agency, user, membership: m };
      });
    },

    /** Odvodí Actor z ŽIVÉHO členství. Volá se na každý request; nic se nekešuje v tokenu. */
    async resolveActor(userId: Id, agencyId: Id): Promise<Actor> {
      const user = await store.users.get(userId);
      if (!user) throw forbidden('Neznámý uživatel');
      const m = (await store.memberships.listByUser(userId)).find((x) => x.agencyId === agencyId);
      if (!m) throw forbidden('Nejste členem této agentury');
      return { userId, name: user.name, agencyId, role: m.role, clientId: m.clientId };
    },

    async myAgencies(userId: Id) {
      const ms = await store.memberships.listByUser(userId);
      const out: { agency: Agency; role: Role; clientId: Id | null }[] = [];
      for (const m of ms) {
        const agency = await store.agencies.get(m.agencyId);
        if (agency) out.push({ agency, role: m.role, clientId: m.clientId });
      }
      return out;
    },

    async getAgency(actor: Actor) {
      const a = await store.agencies.get(actor.agencyId);
      if (!a) throw notFound('Agentura');
      return a;
    },

    async listMembers(actor: Actor) {
      assertStaff(actor);
      const ms = await store.memberships.listByAgency(actor.agencyId);
      const out: (Membership & { user: User })[] = [];
      for (const m of ms) {
        const user = await store.users.get(m.userId);
        if (user) out.push({ ...m, user });
      }
      return out.sort((a, b) => a.user.name.localeCompare(b.user.name, 'cs'));
    },

    async inviteMember(actor: Actor, input: { email: string; name: string; role: Role; clientId?: Id | null }) {
      assertOwner(actor);
      const email = requireEmail(input.email);
      const name = requireText(input.name, 'jméno');
      if (!['owner', 'manager', 'client'].includes(input.role)) throw invalid('Neznámá role', { field: 'role' });
      let clientId: Id | null = null;
      if (input.role === 'client') {
        if (!input.clientId) throw invalid('Uživatel s rolí klient musí mít přiřazeného klienta', { field: 'clientId' });
        const c = await store.clients.get(actor.agencyId, input.clientId);
        if (!c) throw notFound('Klient');
        clientId = c.id;
      }
      return store.tx(async (s) => {
        let user = await s.users.getByEmail(email);
        if (!user) {
          user = { id: newId(), email, name, createdAt: nowIso() };
          await s.users.insert(user);
        }
        const m: Membership = { id: newId(), agencyId: actor.agencyId, userId: user.id, role: input.role, clientId, createdAt: nowIso() };
        await s.memberships.insert(m);
        await audit(s, actor.agencyId, actor, 'member.invited', 'membership', m.id, { email, role: input.role, clientId });
        return { ...m, user };
      });
    },

    async removeMember(actor: Actor, membershipId: Id) {
      assertOwner(actor);
      return store.tx(async (s) => {
        const ms = await s.memberships.listByAgency(actor.agencyId);
        const m = ms.find((x) => x.id === membershipId);
        if (!m) throw notFound('Členství');
        if (m.role === 'owner' && ms.filter((x) => x.role === 'owner').length === 1) {
          throw invalid('Agentura musí mít aspoň jednoho majitele');
        }
        await s.memberships.delete(actor.agencyId, membershipId);
        await audit(s, actor.agencyId, actor, 'member.removed', 'membership', membershipId, { userId: m.userId });
      });
    },
  };

  // =================== Klienti, značky, účty ===================

  const catalog = {
    async listClients(actor: Actor) {
      return (await store.clients.list(actor.agencyId)).filter((c) => canSeeClient(actor, c));
    },

    async createClient(actor: Actor, input: { name: string; contactEmail?: string | null }) {
      assertStaff(actor);
      const c: Client = {
        id: newId(), agencyId: actor.agencyId, name: requireText(input.name, 'název klienta'),
        contactEmail: input.contactEmail ? requireEmail(input.contactEmail) : null, archived: false, createdAt: nowIso(),
      };
      return store.tx(async (s) => {
        await s.clients.insert(c);
        await audit(s, actor.agencyId, actor, 'client.created', 'client', c.id, { name: c.name });
        return c;
      });
    },

    async updateClient(actor: Actor, id: Id, patch: { name?: string; contactEmail?: string | null; archived?: boolean }) {
      assertStaff(actor);
      return store.tx(async (s) => {
        const c = await s.clients.get(actor.agencyId, id);
        if (!c) throw notFound('Klient');
        const next: Client = {
          ...c,
          name: patch.name !== undefined ? requireText(patch.name, 'název klienta') : c.name,
          contactEmail: patch.contactEmail !== undefined ? (patch.contactEmail ? requireEmail(patch.contactEmail) : null) : c.contactEmail,
          archived: patch.archived ?? c.archived,
        };
        await s.clients.update(next);
        await audit(s, actor.agencyId, actor, 'client.updated', 'client', id, patch);
        return next;
      });
    },

    async listBrands(actor: Actor, filter: { clientId?: Id } = {}) {
      const clientId = actor.role === 'client' ? actor.clientId ?? '__none__' : filter.clientId;
      return (await store.brands.list(actor.agencyId, { clientId })).filter((b) => canSeeBrand(actor, b));
    },

    async getBrand(actor: Actor, id: Id) {
      const brand = await loadBrand(store, actor, id);
      const client = await store.clients.get(actor.agencyId, brand.clientId);
      if (!client) throw notFound('Klient');
      const accounts = isStaff(actor) ? await store.accounts.list(actor.agencyId, { brandId: id }) : [];
      return { brand, client, accounts };
    },

    async createBrand(actor: Actor, input: { clientId: Id; name: string; profile?: Partial<BrandProfile>; requiresClientApproval?: boolean }) {
      assertStaff(actor);
      const client = await store.clients.get(actor.agencyId, input.clientId);
      if (!client) throw notFound('Klient');
      assertCanSeeClient(actor, client);
      const b: Brand = {
        id: newId(), agencyId: actor.agencyId, clientId: client.id, name: requireText(input.name, 'název značky'),
        profile: normalizeProfile({ ...defaultProfile(), ...input.profile }),
        requiresClientApproval: input.requiresClientApproval ?? true, archived: false, createdAt: nowIso(),
      };
      return store.tx(async (s) => {
        await s.brands.insert(b);
        await audit(s, actor.agencyId, actor, 'brand.created', 'brand', b.id, { name: b.name, clientId: client.id });
        return b;
      });
    },

    async updateBrand(actor: Actor, id: Id, patch: { name?: string; profile?: Partial<BrandProfile>; requiresClientApproval?: boolean; archived?: boolean }) {
      assertStaff(actor);
      return store.tx(async (s) => {
        const b = await loadBrand(s, actor, id);
        const next: Brand = {
          ...b,
          name: patch.name !== undefined ? requireText(patch.name, 'název značky') : b.name,
          profile: patch.profile ? normalizeProfile({ ...b.profile, ...patch.profile }) : b.profile,
          requiresClientApproval: patch.requiresClientApproval ?? b.requiresClientApproval,
          archived: patch.archived ?? b.archived,
        };
        await s.brands.update(next);
        await audit(s, actor.agencyId, actor, 'brand.updated', 'brand', id, { fields: Object.keys(patch) });
        return next;
      });
    },

    /** Připojení účtu. V MVP přes unified API; tady jen evidence profilu u poskytovatele. */
    async connectAccount(actor: Actor, input: { brandId: Id; network: Network; handle: string; providerRef?: string | null }) {
      assertStaff(actor);
      if (!NETWORKS.includes(input.network)) throw invalid('Neznámá síť', { field: 'network' });
      return store.tx(async (s) => {
        const brand = await loadBrand(s, actor, input.brandId);
        const existing = (await s.accounts.list(actor.agencyId, { brandId: brand.id })).find((a) => a.network === input.network);
        const handle = requireText(input.handle, 'účet', 100);
        if (existing) {
          const next: SocialAccount = { ...existing, handle, status: 'connected', providerRef: input.providerRef ?? existing.providerRef };
          await s.accounts.update(next);
          await audit(s, actor.agencyId, actor, 'account.reconnected', 'account', next.id, { network: input.network });
          return next;
        }
        const a: SocialAccount = {
          id: newId(), agencyId: actor.agencyId, brandId: brand.id, network: input.network, handle,
          providerRef: input.providerRef ?? `sim:${brand.id}:${input.network}`, status: 'connected', createdAt: nowIso(),
        };
        await s.accounts.insert(a);
        await audit(s, actor.agencyId, actor, 'account.connected', 'account', a.id, { network: input.network, handle });
        return a;
      });
    },

    async disconnectAccount(actor: Actor, accountId: Id) {
      assertStaff(actor);
      return store.tx(async (s) => {
        const a = await s.accounts.get(actor.agencyId, accountId);
        if (!a) throw notFound('Účet');
        const next: SocialAccount = { ...a, status: 'disconnected' };
        await s.accounts.update(next);
        await audit(s, actor.agencyId, actor, 'account.disconnected', 'account', a.id, { network: a.network });
        return next;
      });
    },
  };

  // =================== Posty a schvalování ===================

  const content = {
    async listPosts(actor: Actor, filter: PostFilter = {}) {
      const f: PostFilter = { ...filter };
      if (actor.role === 'client') {
        f.clientId = actor.clientId ?? '__none__';
        f.status = (f.status ?? ALL_STATUSES).filter((s) => s !== 'draft');
      }
      const posts = await store.posts.list(actor.agencyId, f);
      return posts.filter((p) => isStaff(actor) || p.status !== 'draft');
    },

    async getPost(actor: Actor, id: Id): Promise<PostDetail> {
      const post = await loadPost(store, actor, id);
      const brand = await store.brands.get(actor.agencyId, post.brandId);
      const client = await store.clients.get(actor.agencyId, post.clientId);
      if (!brand || !client) throw notFound('Značka');
      const approvals = await store.approvals.listByPost(actor.agencyId, id);
      return {
        post, brand, client,
        comments: await store.comments.list(actor.agencyId, id),
        // Token schvalovacího odkazu vidí jen tým agentury.
        approvals: isStaff(actor) ? approvals : approvals.map((a) => ({ ...a, token: '' })),
        jobs: isStaff(actor) ? await store.publishJobs.listByPost(actor.agencyId, id) : [],
        issues: brandCheck(post, brand.profile),
        accounts: isStaff(actor) ? await store.accounts.list(actor.agencyId, { brandId: brand.id }) : [],
      };
    },

    async createPost(actor: Actor, input: {
      brandId: Id; title?: string; body?: string; networks?: Network[]; scheduledAt?: string | null;
      media?: MediaRef[]; aiAssisted?: boolean; overrides?: Partial<Record<Network, string>>;
    }) {
      assertStaff(actor);
      return store.tx(async (s) => {
        const brand = await loadBrand(s, actor, input.brandId);
        const networks = validNetworks(input.networks ?? []);
        const body = typeof input.body === 'string' ? input.body : '';
        const now = nowIso();
        const p: Post = {
          id: newId(), agencyId: actor.agencyId, brandId: brand.id, clientId: brand.clientId,
          title: (input.title ?? '').trim().slice(0, 120) || firstLine(body) || 'Nový post',
          body, overrides: cleanOverrides(input.overrides, networks), networks, media: validMedia(input.media),
          status: 'draft', scheduledAt: validDate(input.scheduledAt), publishedAt: null,
          version: 1, versions: [{ n: 1, body, networks, createdAt: now, createdBy: actor.userId }],
          aiAssisted: !!input.aiAssisted, createdBy: actor.userId, createdAt: now, updatedAt: now,
        };
        await s.posts.insert(p);
        await audit(s, actor.agencyId, actor, 'post.created', 'post', p.id, { brandId: brand.id });
        return p;
      });
    },

    async updatePost(actor: Actor, id: Id, patch: {
      title?: string; body?: string; networks?: Network[]; overrides?: Partial<Record<Network, string>>;
      scheduledAt?: string | null; media?: MediaRef[]; aiAssisted?: boolean;
    }, expectedUpdatedAt?: string) {
      assertStaff(actor);
      return store.tx(async (s) => {
        const before = await loadPost(s, actor, id);
        if (expectedUpdatedAt && expectedUpdatedAt !== before.updatedAt) throw conflict('Post mezitím upravil někdo jiný');
        if (!EDITABLE.includes(before.status)) {
          throw new DomainError('invalid_transition', 'Publikovaný post už nejde upravit');
        }
        const after: Post = structuredClone(before);
        if (patch.title !== undefined) after.title = patch.title.trim().slice(0, 120) || before.title;
        if (patch.body !== undefined) after.body = patch.body;
        if (patch.networks !== undefined) after.networks = validNetworks(patch.networks);
        if (patch.overrides !== undefined || patch.networks !== undefined) {
          after.overrides = cleanOverrides(patch.overrides ?? before.overrides, after.networks);
        }
        if (patch.media !== undefined) after.media = validMedia(patch.media);
        if (patch.aiAssisted) after.aiAssisted = true;
        if (patch.scheduledAt !== undefined) after.scheduledAt = validDate(patch.scheduledAt);

        const contentChanged =
          after.body !== before.body ||
          JSON.stringify(after.networks) !== JSON.stringify(before.networks) ||
          JSON.stringify(after.overrides) !== JSON.stringify(before.overrides) ||
          JSON.stringify(after.media) !== JSON.stringify(before.media);

        if (contentChanged) {
          after.version = before.version + 1;
          after.versions = [...before.versions, { n: after.version, body: after.body, networks: after.networks, createdAt: nowIso(), createdBy: actor.userId }];
          if (RESETS_APPROVAL.includes(before.status)) {
            // Změna obsahu ruší dřívější schválení (schvaluje se konkrétní verze).
            after.status = 'draft';
            await supersedePending(s, before);
            await cancelPendingJobs(s, before, 'Obsah postu se změnil');
          }
        } else if (patch.scheduledAt !== undefined && before.status === 'scheduled') {
          if (!after.scheduledAt) throw invalid('Naplánovaný post musí mít termín; použijte zrušení plánu');
          if (after.scheduledAt <= nowIso()) throw invalid('Termín musí být v budoucnosti', { field: 'scheduledAt' });
          for (const j of await s.publishJobs.listByPost(actor.agencyId, id)) {
            if (j.status === 'pending' && j.postVersion === before.version) {
              await s.publishJobs.update({ ...j, runAt: after.scheduledAt, updatedAt: nowIso() });
            }
          }
        }
        const saved = await savePost(s, before, after);
        await audit(s, actor.agencyId, actor, contentChanged ? 'post.edited' : 'post.updated', 'post', id, {
          version: saved.version, statusFrom: before.status, statusTo: saved.status,
        });
        return saved;
      });
    },

    async submitForApproval(actor: Actor, id: Id, input: { note?: string } = {}) {
      assertStaff(actor);
      return store.tx(async (s) => {
        const before = await loadPost(s, actor, id);
        if (!['draft', 'changes_requested'].includes(before.status)) {
          throw new DomainError('invalid_transition', 'Ke schválení jde poslat jen koncept nebo post vrácený k úpravě');
        }
        const brand = await loadBrand(s, actor, before.brandId);
        const issues = brandCheck(before, brand.profile);
        if (hasBlockingIssues(issues)) throw invalid('Post neprošel kontrolou značky', { issues });
        await supersedePending(s, before);
        const after = structuredClone(before);
        let approval: ApprovalRequest | null = null;
        if (brand.requiresClientApproval) {
          after.status = 'in_review';
          approval = {
            id: newId(), agencyId: actor.agencyId, postId: id, postVersion: before.version, token: deps.newToken(),
            status: 'pending', requestedBy: actor.userId, requestedAt: nowIso(),
            expiresAt: new Date(deps.clock().getTime() + APPROVAL_TTL_DAYS * 864e5).toISOString(),
            decidedAt: null, decidedByName: null, decidedByUserId: null, note: input.note?.trim() || null,
          };
          await s.approvals.insert(approval);
        } else {
          after.status = 'approved';
        }
        if (input.note?.trim()) {
          await s.comments.insert({
            id: newId(), agencyId: actor.agencyId, postId: id, authorId: actor.userId, authorName: actor.name,
            authorRole: actor.role, body: input.note.trim(), postVersion: before.version, createdAt: nowIso(),
          });
        }
        const saved = await savePost(s, before, after);
        await audit(s, actor.agencyId, actor, brand.requiresClientApproval ? 'post.submitted' : 'post.approved_internally', 'post', id, { version: before.version });
        return { post: saved, approval };
      });
    },

    async decide(actor: Actor, postId: Id, decision: 'approved' | 'changes_requested', note?: string) {
      return store.tx(async (s) => {
        const post = await loadPost(s, actor, postId);
        assertCanDecide(actor, post);
        const pending = (await s.approvals.listByPost(actor.agencyId, postId)).find((a) => a.status === 'pending');
        if (!pending) throw new DomainError('invalid_transition', 'Post nečeká na schválení');
        return applyDecision(s, post, pending, decision, note, { userId: actor.userId, name: actor.name, role: actor.role });
      });
    },

    async getPublicApproval(token: string): Promise<PublicApprovalView> {
      const a = await store.approvals.getByToken(token);
      if (!a) throw notFound('Odkaz');
      const [post, agency] = await Promise.all([store.posts.get(a.agencyId, a.postId), store.agencies.get(a.agencyId)]);
      if (!post || !agency) throw notFound('Post');
      const brand = await store.brands.get(a.agencyId, post.brandId);
      const client = await store.clients.get(a.agencyId, post.clientId);
      if (!brand || !client) throw notFound('Značka');
      const comments = await store.comments.list(a.agencyId, post.id);
      return {
        agencyName: agency.name, brandName: brand.name, brandColor: brand.profile.color, clientName: client.name,
        post: {
          id: post.id, title: post.title, body: post.body, overrides: post.overrides, networks: post.networks,
          media: post.media, scheduledAt: post.scheduledAt, version: post.version,
        },
        approval: {
          status: a.status === 'pending' && a.expiresAt < nowIso() ? 'superseded' : a.status,
          expiresAt: a.expiresAt, decidedAt: a.decidedAt, decidedByName: a.decidedByName, note: a.note, postVersion: a.postVersion,
        },
        comments: comments.map((c) => ({ authorName: c.authorName, authorRole: c.authorRole, body: c.body, createdAt: c.createdAt })),
        isCurrent: post.version === a.postVersion,
      };
    },

    async decideByToken(token: string, input: { name: string; decision: 'approved' | 'changes_requested'; note?: string }) {
      const name = requireText(input.name, 'jméno', 100);
      return store.tx(async (s) => {
        const a = await s.approvals.getByToken(token);
        if (!a) throw notFound('Odkaz');
        if (a.status !== 'pending') throw new DomainError('invalid_transition', 'O tomto postu už bylo rozhodnuto');
        if (a.expiresAt < nowIso()) throw new DomainError('expired', 'Platnost odkazu vypršela');
        const post = await s.posts.get(a.agencyId, a.postId);
        if (!post) throw notFound('Post');
        return applyDecision(s, post, a, input.decision, input.note, { userId: null, name, role: 'guest' });
      });
    },

    async addComment(actor: Actor, postId: Id, body: string) {
      const text = requireText(body, 'komentář', 4000);
      return store.tx(async (s) => {
        const post = await loadPost(s, actor, postId);
        const c: Comment = {
          id: newId(), agencyId: actor.agencyId, postId, authorId: actor.userId, authorName: actor.name,
          authorRole: actor.role, body: text, postVersion: post.version, createdAt: nowIso(),
        };
        await s.comments.insert(c);
        return c;
      });
    },

    async addCommentByToken(token: string, input: { name: string; body: string }) {
      const name = requireText(input.name, 'jméno', 100);
      const text = requireText(input.body, 'komentář', 4000);
      return store.tx(async (s) => {
        const a = await s.approvals.getByToken(token);
        if (!a || a.expiresAt < nowIso()) throw notFound('Odkaz');
        const post = await s.posts.get(a.agencyId, a.postId);
        if (!post) throw notFound('Post');
        const c: Comment = {
          id: newId(), agencyId: a.agencyId, postId: post.id, authorId: null, authorName: name, authorRole: 'guest',
          body: text, postVersion: post.version, createdAt: nowIso(),
        };
        await s.comments.insert(c);
        // Host přes odkaz nedostane interní identifikátory.
        return { authorName: c.authorName, authorRole: c.authorRole, body: c.body, createdAt: c.createdAt };
      });
    },

    async schedule(actor: Actor, id: Id, scheduledAt?: string) {
      assertStaff(actor);
      return store.tx(async (s) => {
        const before = await loadPost(s, actor, id);
        if (before.status !== 'approved') {
          throw new DomainError('invalid_transition', 'Naplánovat jde jen schválený post');
        }
        const when = validDate(scheduledAt ?? before.scheduledAt);
        if (!when) throw invalid('Chybí termín publikace', { field: 'scheduledAt' });
        if (when <= nowIso()) throw invalid('Termín musí být v budoucnosti', { field: 'scheduledAt' });
        const accounts = await s.accounts.list(actor.agencyId, { brandId: before.brandId });
        const missing = before.networks.filter((n) => !accounts.some((a) => a.network === n && a.status === 'connected'));
        if (missing.length) {
          throw invalid(`Značka nemá připojený účet: ${missing.map((n) => NETWORK_LIMITS[n].label).join(', ')}`, { missing });
        }
        for (const n of before.networks) {
          const acc = accounts.find((a) => a.network === n && a.status === 'connected')!;
          await s.publishJobs.insertIfAbsent({
            id: newId(), agencyId: actor.agencyId, postId: id, postVersion: before.version, network: n, accountId: acc.id,
            idempotencyKey: `${id}:v${before.version}:${n}`, status: 'pending', attempts: 0, runAt: when,
            lockedUntil: null, externalId: null, externalUrl: null, lastError: null, createdAt: nowIso(), updatedAt: nowIso(),
          });
        }
        // Úloha se stejným klíčem mohla zůstat zrušená po dřívějším odplánování: obnovit ji.
        for (const j of await s.publishJobs.listByPost(actor.agencyId, id)) {
          if (j.postVersion === before.version && j.status === 'cancelled') {
            await s.publishJobs.update({ ...j, status: 'pending', runAt: when, lastError: null, updatedAt: nowIso() });
          }
        }
        const after = { ...structuredClone(before), status: 'scheduled' as const, scheduledAt: when };
        const saved = await savePost(s, before, after);
        await audit(s, actor.agencyId, actor, 'post.scheduled', 'post', id, { scheduledAt: when, version: before.version });
        return saved;
      });
    },

    async unschedule(actor: Actor, id: Id) {
      assertStaff(actor);
      return store.tx(async (s) => {
        const before = await loadPost(s, actor, id);
        if (before.status !== 'scheduled') throw new DomainError('invalid_transition', 'Post není naplánovaný');
        await cancelPendingJobs(s, before, 'Plán zrušen');
        const saved = await savePost(s, before, { ...structuredClone(before), status: 'approved' });
        await audit(s, actor.agencyId, actor, 'post.unscheduled', 'post', id);
        return saved;
      });
    },

    async retryFailed(actor: Actor, id: Id) {
      assertStaff(actor);
      return store.tx(async (s) => {
        const before = await loadPost(s, actor, id);
        if (before.status !== 'failed') throw new DomainError('invalid_transition', 'Post neselhal');
        for (const j of await s.publishJobs.listByPost(actor.agencyId, id)) {
          if (j.status === 'failed' && j.postVersion === before.version) {
            await s.publishJobs.update({ ...j, status: 'pending', attempts: 0, runAt: nowIso(), lockedUntil: null, lastError: null, updatedAt: nowIso() });
          }
        }
        const saved = await savePost(s, before, { ...structuredClone(before), status: 'publishing' });
        await audit(s, actor.agencyId, actor, 'post.retry', 'post', id);
        return saved;
      });
    },

    async pendingApprovals(actor: Actor) {
      const pending = await store.approvals.listPending(actor.agencyId);
      const out: { approval: ApprovalRequest; post: Post }[] = [];
      for (const a of pending) {
        const post = await store.posts.get(actor.agencyId, a.postId);
        if (post && (isStaff(actor) || (actor.role === 'client' && post.clientId === actor.clientId))) {
          out.push({ approval: isStaff(actor) ? a : { ...a, token: '' }, post });
        }
      }
      return out.sort((x, y) => x.approval.requestedAt.localeCompare(y.approval.requestedAt));
    },

    async activity(actor: Actor, filter: { entityId?: Id; limit?: number } = {}) {
      assertStaff(actor);
      return store.audit.list(actor.agencyId, filter);
    },

    checkText(brand: Brand, input: { body: string; networks: Network[]; overrides?: Partial<Record<Network, string>> }) {
      return brandCheck(input, brand.profile);
    },
  };

  async function applyDecision(
    s: Store, post: Post, a: ApprovalRequest, decision: 'approved' | 'changes_requested', note: string | undefined,
    who: { userId: Id | null; name: string; role: Role | 'guest' },
  ) {
    if (decision !== 'approved' && decision !== 'changes_requested') throw invalid('Neznámé rozhodnutí');
    if (a.postVersion !== post.version || post.status !== 'in_review') {
      await s.approvals.update({ ...a, status: 'superseded' });
      throw new DomainError('conflict', 'Post se mezitím změnil. Otevřete prosím aktuální verzi.');
    }
    if (decision === 'changes_requested' && !note?.trim()) {
      throw invalid('Napište prosím, co upravit', { field: 'note' });
    }
    const decided: ApprovalRequest = {
      ...a, status: decision, decidedAt: nowIso(), decidedByName: who.name, decidedByUserId: who.userId, note: note?.trim() || a.note,
    };
    await s.approvals.update(decided);
    if (note?.trim()) {
      await s.comments.insert({
        id: newId(), agencyId: post.agencyId, postId: post.id, authorId: who.userId, authorName: who.name,
        authorRole: who.role, body: note.trim(), postVersion: post.version, createdAt: nowIso(),
      });
    }
    const saved = await savePost(s, post, { ...structuredClone(post), status: decision });
    await audit(s, post.agencyId, who, decision === 'approved' ? 'post.approved' : 'post.changes_requested', 'approval', a.id, {
      postId: post.id, version: post.version, via: who.role === 'guest' ? 'link' : 'portal',
    });
    return { post: saved, approval: decided };
  }

  // =================== Publikace (worker) ===================

  const publishing = {
    /** Zpracuje splatné úlohy. Volá worker v intervalu; bezpečné spouštět souběžně. */
    async runDue(limit = 20) {
      const now = deps.clock();
      const reconciled = await reconcileUnknown();
      const jobs = await store.publishJobs.claimDue(now.toISOString(), new Date(now.getTime() + LOCK_MS).toISOString(), limit);
      const results: { jobId: Id; status: PublishJob['status'] }[] = [];
      for (const j of jobs) results.push({ jobId: j.id, status: await runJob(j) });
      return { processed: results, reconciled };
    },
  };

  /** Úlohy s neznámým výsledkem se nejdřív dohledají u poskytovatele, nikdy se slepě neopakují (G2). */
  async function reconcileUnknown() {
    const out: Id[] = [];
    for (const j of await store.publishJobs.listUnknown(50)) {
      const r = await deps.publisher.lookup(j.idempotencyKey, j.network).catch(() => null);
      if (!r) continue; // poskytovatel nedostupný, zkusíme příště
      await store.tx(async (s) => {
        if (r.found) {
          await s.publishJobs.update({ ...j, status: 'succeeded', externalId: r.externalId, externalUrl: r.url, lockedUntil: null, lastError: null, updatedAt: nowIso() });
        } else {
          await s.publishJobs.update({ ...j, status: 'pending', lockedUntil: null, runAt: nowIso(), updatedAt: nowIso() });
        }
        await refreshPostStatus(s, j.agencyId, j.postId);
      });
      out.push(j.id);
    }
    return out;
  }

  async function runJob(job: PublishJob): Promise<PublishJob['status']> {
    const post = await store.posts.get(job.agencyId, job.postId);
    const account = await store.accounts.get(job.agencyId, job.accountId);
    const finish = async (patch: Partial<PublishJob>) => {
      const next: PublishJob = { ...job, ...patch, lockedUntil: null, updatedAt: nowIso() };
      await store.tx(async (s) => {
        await s.publishJobs.update(next);
        await refreshPostStatus(s, job.agencyId, job.postId);
      });
      return next.status;
    };
    if (!post || post.version !== job.postVersion || !['scheduled', 'publishing'].includes(post.status)) {
      return finish({ status: 'cancelled', lastError: 'Post se změnil nebo byl odplánován' });
    }
    if (!account || account.status !== 'connected') {
      return finish({ status: 'failed', lastError: 'Účet není připojený' });
    }
    if (post.status === 'scheduled') {
      await store.tx(async (s) => {
        const cur = await s.posts.get(post.agencyId, post.id);
        if (cur && cur.status === 'scheduled') await savePost(s, cur, { ...structuredClone(cur), status: 'publishing' });
      });
    }
    try {
      const r = await deps.publisher.publish({
        idempotencyKey: job.idempotencyKey, network: job.network, providerRef: account.providerRef, handle: account.handle,
        text: textForNetwork(post.body, post.overrides, job.network), media: post.media,
      });
      if (r.ok) return finish({ status: 'succeeded', externalId: r.externalId, externalUrl: r.url, lastError: null });
      if (r.retryable && job.attempts < MAX_PUBLISH_ATTEMPTS) {
        const backoff = 2 ** job.attempts * 60 * 1000;
        return finish({ status: 'pending', lastError: r.error, runAt: new Date(deps.clock().getTime() + backoff).toISOString() });
      }
      return finish({ status: 'failed', lastError: r.error });
    } catch (e) {
      // Ztracená odpověď: NEVÍME, jestli post vyšel. Neopakovat naslepo (duplicita na síti).
      return finish({ status: 'unknown', lastError: e instanceof Error ? e.message : 'Neznámá chyba' });
    }
  }

  async function refreshPostStatus(s: Store, agencyId: Id, postId: Id) {
    const post = await s.posts.get(agencyId, postId);
    if (!post || !['scheduled', 'publishing', 'failed'].includes(post.status)) return;
    const jobs = (await s.publishJobs.listByPost(agencyId, postId)).filter((j) => j.postVersion === post.version && j.status !== 'cancelled');
    if (!jobs.length) return;
    let status: PostStatus = post.status;
    let publishedAt = post.publishedAt;
    if (jobs.every((j) => j.status === 'succeeded')) {
      status = 'published';
      publishedAt = nowIso();
    } else if (jobs.some((j) => j.status === 'failed') && jobs.every((j) => ['succeeded', 'failed'].includes(j.status))) {
      status = 'failed';
    } else if (jobs.some((j) => j.status !== 'pending' || j.attempts > 0)) {
      status = 'publishing';
    }
    if (status !== post.status) {
      await savePost(s, post, { ...structuredClone(post), status, publishedAt });
      await audit(s, agencyId, { name: 'Systém' }, `post.${status}`, 'post', postId, {
        errors: jobs.filter((j) => j.lastError).map((j) => `${j.network}: ${j.lastError}`),
      });
    }
  }

  // =================== Metriky a reporty ===================

  const reports = {
    /** Stáhne metriky publikovaných postů agentury. Volá worker (např. jednou za hodinu). */
    async collectMetrics(agencyId: Id) {
      const posts = await store.posts.list(agencyId, { status: ['published'] });
      let n = 0;
      for (const p of posts) {
        for (const j of await store.publishJobs.listByPost(agencyId, p.id)) {
          if (j.status !== 'succeeded' || !j.externalId || j.postVersion !== p.version) continue;
          const m = await deps.metrics.fetch({ network: j.network, externalId: j.externalId, publishedAt: p.publishedAt ?? j.updatedAt, now: nowIso() });
          const row: PostMetrics = { agencyId, postId: p.id, brandId: p.brandId, network: j.network, ...m, collectedAt: nowIso() };
          await store.metrics.upsert(row);
          n++;
        }
      }
      return n;
    },

    /** Souhrn pro přehled: posledních 30 dní proti předchozím 30, a co se děje tento týden. */
    async overview(actor: Actor, filter: { brandId?: Id } = {}) {
      const brands = (await store.brands.list(actor.agencyId, actor.role === 'client' ? { clientId: actor.clientId ?? '__none__' } : {}))
        .filter((b) => canSeeBrand(actor, b) && (!filter.brandId || b.id === filter.brandId));
      const ids = new Set(brands.map((b) => b.id));
      const now = deps.clock();
      const iso = (d: number) => new Date(now.getTime() + d * 864e5).toISOString();
      const posts = (await content.listPosts(actor)).filter((p) => ids.has(p.brandId));
      const metrics = (await Promise.all(brands.map((b) => store.metrics.listByBrand(actor.agencyId, b.id)))).flat();
      const pub = posts.filter((p) => p.status === 'published' && p.publishedAt);
      const cur = sumTotals(pub.filter((p) => p.publishedAt! >= iso(-30)), metrics);
      const prev = sumTotals(pub.filter((p) => p.publishedAt! >= iso(-60) && p.publishedAt! < iso(-30)), metrics);
      // týden = pondělí až neděle v Praze; přibližně podle UTC
      const dow = (now.getUTCDay() + 6) % 7;
      const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow)).toISOString();
      const weekEnd = new Date(Date.parse(weekStart) + 7 * 864e5).toISOString();
      const inWeek = (d: string | null) => !!d && d >= weekStart && d < weekEnd;
      const busy = new Set(posts.filter((p) => p.scheduledAt && p.status !== 'draft').map((p) => p.scheduledAt!.slice(0, 10)));
      let emptyDays = 0;
      for (let i = 0; i < 14; i++) if (!busy.has(iso(i).slice(0, 10))) emptyDays++;
      return {
        reach30: cur.reach,
        reach30Prev: prev.reach,
        engagementRate30: cur.engagementRate,
        engagementRate30Prev: prev.engagementRate,
        published30: cur.posts,
        goingOutThisWeek: posts.filter((p) => ['scheduled', 'approved', 'in_review'].includes(p.status) && inWeek(p.scheduledAt) && p.scheduledAt! >= now.toISOString()).length,
        scheduledThisWeek: posts.filter((p) => p.status === 'scheduled' && inWeek(p.scheduledAt)).length,
        publishedThisWeek: posts.filter((p) => p.status === 'published' && inWeek(p.publishedAt)).length,
        awaitingApproval: posts.filter((p) => p.status === 'in_review').length,
        emptyDaysNext14: emptyDays,
        brands: brands.length,
      };
    },

    async monthly(actor: Actor, brandId: Id, month: string, language: Language = 'cs'): Promise<MonthlyReport> {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw invalid('Měsíc musí být ve tvaru RRRR-MM');
      const brand = await loadBrand(store, actor, brandId);
      const client = await store.clients.get(actor.agencyId, brand.clientId);
      if (!client) throw notFound('Klient');
      const [y, m] = month.split('-').map(Number) as [number, number];
      const from = new Date(Date.UTC(y, m - 1, 1)).toISOString();
      const to = new Date(Date.UTC(y, m, 1)).toISOString();
      const prevFrom = new Date(Date.UTC(y, m - 2, 1)).toISOString();
      const metrics = await store.metrics.listByBrand(actor.agencyId, brandId);
      const published = await store.posts.list(actor.agencyId, { brandId, status: ['published'] });
      const inRange = (p: Post, a: string, b: string) => !!p.publishedAt && p.publishedAt >= a && p.publishedAt < b;
      const cur = published.filter((p) => inRange(p, from, to));
      const prev = published.filter((p) => inRange(p, prevFrom, from));
      const totals = sumTotals(cur, metrics);
      const previousTotals = prev.length ? sumTotals(prev, metrics) : null;
      const byNetwork = NETWORKS.map((n) => ({ network: n, ...sumTotals(cur.filter((p) => p.networks.includes(n)), metrics.filter((x) => x.network === n)) }))
        .filter((x) => x.posts > 0);
      const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const daily = Array.from({ length: days }, (_, i) => {
        const date = `${month}-${String(i + 1).padStart(2, '0')}`;
        const ps = cur.filter((p) => p.publishedAt!.slice(0, 10) === date);
        const t = sumTotals(ps, metrics);
        return { date, reach: t.reach, engagements: t.engagements };
      });
      const topPosts = cur
        .map((post) => {
          const t = sumTotals([post], metrics);
          return { post, reach: t.reach, engagements: t.engagements, engagementRate: t.engagementRate };
        })
        .sort((a, b) => b.engagements - a.engagements)
        .slice(0, 3);
      const periodLabel = `${MONTHS_CS[m - 1]} ${y}`;
      const best = [...byNetwork].sort((a, b) => b.engagements - a.engagements)[0];
      const summaryInput = {
        brandName: brand.name, periodLabel, posts: totals.posts, reach: totals.reach, engagements: totals.engagements,
        engagementRate: totals.engagementRate,
        previous: previousTotals && { reach: previousTotals.reach, engagements: previousTotals.engagements, engagementRate: previousTotals.engagementRate },
        topPostTitle: topPosts[0]?.post.title ?? null, bestNetwork: best ? NETWORK_LIMITS[best.network].label : null,
      };
      let summary: string;
      let summaryByAi = deps.assistant.isAi;
      try {
        summary = await deps.assistant.summarizeReport(summaryInput, language);
      } catch {
        // Když AI nejede, report musí vyjít i tak.
        const { TemplateAssistant } = await import('./assistant.js');
        summary = await new TemplateAssistant().summarizeReport(summaryInput);
        summaryByAi = false;
      }
      return { brand, client, month, periodLabel, totals, previous: previousTotals, byNetwork, daily, topPosts, summary, summaryByAi };
    },
  };

  // =================== AI asistent ===================

  const ai = {
    get label() {
      return deps.assistant.label;
    },
    get isAi() {
      return deps.assistant.isAi;
    },
    async info(_actor: Actor) {
      return { label: deps.assistant.label, isAi: deps.assistant.isAi, publisher: deps.publisher.label };
    },
    async draft(actor: Actor, input: { brandId: Id; brief: string; networks: Network[]; language?: Language; variants?: number }) {
      assertStaff(actor);
      const brand = await loadBrand(store, actor, input.brandId);
      const client = await store.clients.get(actor.agencyId, brand.clientId);
      const brief = requireText(input.brief, 'brief', 4000);
      const networks = validNetworks(input.networks.length ? input.networks : ['facebook']);
      const language = input.language ?? brand.profile.languages[0] ?? 'cs';
      const variants: DraftVariant[] = await deps.assistant.draft({
        brand, clientName: client?.name ?? '', brief, networks, language, variants: Math.min(Math.max(input.variants ?? 3, 1), 3),
      });
      await audit(store, actor.agencyId, actor, 'ai.draft', 'brand', brand.id, { assistant: deps.assistant.label, variants: variants.length });
      return variants.map((v) => ({ ...v, issues: brandCheck({ body: v.body, networks }, brand.profile) }));
    },
    async rewrite(actor: Actor, input: { brandId: Id; body: string; instruction: string; language?: Language }) {
      assertStaff(actor);
      const brand = await loadBrand(store, actor, input.brandId);
      const body = await deps.assistant.rewrite({
        brand, body: requireText(input.body, 'text', 10000), instruction: requireText(input.instruction, 'pokyn', 500),
        language: input.language ?? brand.profile.languages[0] ?? 'cs',
      });
      return { body, issues: brandCheck({ body, networks: ['facebook', 'instagram', 'linkedin'] }, brand.profile) };
    },
  };

  return { tenancy, catalog, content, publishing, reports, ai, deps };
}

export type Services = ReturnType<typeof createServices>;

const ALL_STATUSES: PostStatus[] = ['draft', 'in_review', 'changes_requested', 'approved', 'scheduled', 'publishing', 'published', 'failed'];

function sumTotals(posts: Post[], metrics: PostMetrics[]): ReportTotals {
  const ids = new Set(posts.map((p) => p.id));
  const rows = metrics.filter((m) => ids.has(m.postId));
  const t = rows.reduce(
    (acc, m) => ({ reach: acc.reach + m.reach, impressions: acc.impressions + m.impressions, engagements: acc.engagements + m.engagements, clicks: acc.clicks + m.clicks }),
    { reach: 0, impressions: 0, engagements: 0, clicks: 0 },
  );
  return { posts: posts.length, ...t, engagementRate: t.reach ? t.engagements / t.reach : 0 };
}

function firstLine(s: string) {
  return (s.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 80);
}

const MAX_MEDIA = 4;
const MAX_MEDIA_URL = 1_500_000;

/** Obrázky postu: nejvýš 4, data:image (z nahrání) nebo https URL z úložiště. */
function validMedia(v: unknown): MediaRef[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw invalid('Média musí být seznam', { field: 'media' });
  if (v.length > MAX_MEDIA) throw invalid(`Nejvýš ${MAX_MEDIA} obrázky na post`, { field: 'media' });
  return v.map((m: Partial<MediaRef>) => {
    const url = String(m?.url ?? '');
    const okUrl = /^data:image\/(png|jpeg|webp|gif|svg\+xml)[;,]/.test(url) || /^https:\/\//.test(url);
    if (!okUrl) throw invalid('Nepodporovaný formát obrázku', { field: 'media' });
    if (url.length > MAX_MEDIA_URL) throw invalid('Obrázek je příliš velký (max. asi 1 MB)', { field: 'media' });
    return {
      id: String(m?.id || '').slice(0, 64) || crypto.randomUUID(),
      kind: m?.kind === 'video' ? 'video' : 'image',
      url,
      alt: String(m?.alt ?? '').slice(0, 300),
    };
  });
}

function validDate(v: string | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw invalid('Neplatné datum', { field: 'scheduledAt' });
  return new Date(t).toISOString();
}

function cleanOverrides(o: Partial<Record<Network, string>> | undefined, networks: Network[]) {
  const out: Partial<Record<Network, string>> = {};
  for (const n of networks) {
    const v = o?.[n];
    if (typeof v === 'string' && v.trim()) out[n] = v;
  }
  return out;
}

function normalizeProfile(p: BrandProfile): BrandProfile {
  const list = (v: unknown, max: number) =>
    (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean).slice(0, max);
  const langs = list(p.languages, 3).filter((l): l is Language => ['cs', 'sk', 'en'].includes(l));
  return {
    tone: String(p.tone ?? '').slice(0, 500),
    audience: String(p.audience ?? '').slice(0, 500),
    bannedWords: list(p.bannedWords, 100),
    examples: list(p.examples, 10).map((e) => e.slice(0, 3000)),
    defaultHashtags: list(p.defaultHashtags, 30).map((h) => (h.startsWith('#') ? h : `#${h}`)),
    maxHashtags: Math.min(Math.max(Number(p.maxHashtags) || 0, 0), 30),
    languages: langs.length ? langs : ['cs'],
    emoji: ['none', 'few', 'many'].includes(p.emoji) ? p.emoji : 'few',
    color: /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : '#3b5bdb',
  };
}
