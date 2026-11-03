import { describe, expect, it } from 'vitest';
import type { Store } from '../store.js';
import type { Agency, Brand, Client, DesignSpec, Post, PublishJob } from '../types.js';

/**
 * Kontrakt, který musí splnit každá implementace Store (paměť i Postgres).
 * Hlavní důraz: izolace agentur, optimistický zámek, idempotence outboxu a atomický claim.
 */
export function storeContract(name: string, make: () => Promise<{ store: Store; cleanup?: () => Promise<void> }>) {
  const uid = () => crypto.randomUUID();
  const now = '2026-11-02T09:00:00.000Z';

  async function fixture(store: Store) {
    const mk = (n: string): Agency => ({ id: uid(), name: n, slug: `${n}-${uid().slice(0, 8)}`, plan: 'pilot', createdAt: now });
    const a = mk('a');
    const b = mk('b');
    await store.agencies.insert(a);
    await store.agencies.insert(b);
    const client: Client = { id: uid(), agencyId: a.id, name: 'Klient A', contactEmail: null, archived: false, createdAt: now };
    await store.clients.insert(client);
    const brand: Brand = {
      id: uid(), agencyId: a.id, clientId: client.id, name: 'Značka A', requiresClientApproval: true, archived: false, createdAt: now,
      profile: { tone: '', audience: '', bannedWords: [], examples: [], defaultHashtags: [], maxHashtags: 3, languages: ['cs'], emoji: 'few', color: '#3b5bdb', secondaryColor: '#111111', accentColor: '#ffcc00', logoUrl: null, fontHeading: 'Onest', fontBody: 'Onest', pillars: [], website: null },
    };
    await store.brands.insert(brand);
    const post: Post = {
      id: uid(), agencyId: a.id, brandId: brand.id, clientId: client.id, title: 'T', body: 'B', overrides: {}, networks: ['facebook'],
      media: [], design: null, status: 'draft', scheduledAt: '2026-11-10T10:00:00.000Z', publishedAt: null, version: 1,
      versions: [{ n: 1, body: 'B', networks: ['facebook'], createdAt: now, createdBy: uid() }], aiAssisted: false,
      createdBy: uid(), createdAt: now, updatedAt: now,
    };
    await store.posts.insert(post);
    return { a, b, client, brand, post };
  }

  const job = (f: Awaited<ReturnType<typeof fixture>>, patch: Partial<PublishJob> = {}): PublishJob => ({
    id: uid(), agencyId: f.a.id, postId: f.post.id, postVersion: 1, network: 'facebook', accountId: uid(),
    idempotencyKey: `${f.post.id}:v1:facebook:${uid()}`, status: 'pending', attempts: 0, runAt: now, lockedUntil: null,
    externalId: null, externalUrl: null, lastError: null, createdAt: now, updatedAt: now, ...patch,
  });

  describe(`Store contract: ${name}`, () => {
    it('nevrací data jiné agentury', async () => {
      const { store, cleanup } = await make();
      try {
        const f = await fixture(store);
        expect(await store.posts.get(f.b.id, f.post.id)).toBeNull();
        expect(await store.brands.get(f.b.id, f.brand.id)).toBeNull();
        expect(await store.clients.list(f.b.id)).toEqual([]);
        expect(await store.posts.list(f.b.id)).toEqual([]);
        expect((await store.posts.get(f.a.id, f.post.id))?.title).toBe('T');
      } finally {
        await cleanup?.();
      }
    });

    it('update s cizím agencyId selže', async () => {
      const { store, cleanup } = await make();
      try {
        const f = await fixture(store);
        await expect(store.brands.update({ ...f.brand, agencyId: f.b.id, name: 'X' })).rejects.toThrow();
        expect((await store.brands.get(f.a.id, f.brand.id))?.name).toBe('Značka A');
      } finally {
        await cleanup?.();
      }
    });

    it('optimistický zámek u postu', async () => {
      const { store, cleanup } = await make();
      try {
        const f = await fixture(store);
        const next = { ...f.post, title: 'T2', updatedAt: '2026-11-02T09:00:01.000Z' };
        await store.posts.update(next, f.post.updatedAt);
        await expect(store.posts.update({ ...f.post, title: 'T3' }, f.post.updatedAt)).rejects.toMatchObject({ code: 'conflict' });
        expect((await store.posts.get(f.a.id, f.post.id))?.title).toBe('T2');
      } finally {
        await cleanup?.();
      }
    });

    it('návrh vizuálu (design) projde tam i zpět beze změny', async () => {
      const { store, cleanup } = await make();
      try {
        const f = await fixture(store);
        expect((await store.posts.get(f.a.id, f.post.id))?.design).toBeNull();
        const design: DesignSpec = {
          format: 'carousel', templateId: 'list', aspect: '4:5', seed: 123456,
          slides: [
            { kicker: 'TIP', headline: 'Jak poznat poctivý kvas?', body: 'Tři znaky – „uvozovky“ & emoji 🍞' },
            { headline: 'Kůrka praská', mediaUrl: 'https://cdn.example/a.jpg' },
            { headline: 'Uložte si to', mediaUrl: null },
          ],
          cta: 'Uložte si to', music: null,
        };
        const next = { ...f.post, design, updatedAt: '2026-11-02T09:00:01.000Z' };
        await store.posts.update(next, f.post.updatedAt);
        expect((await store.posts.get(f.a.id, f.post.id))?.design).toEqual(design);
        const reel: DesignSpec = { format: 'reel', templateId: 'gradient', aspect: '9:16', seed: 1, durationSec: 12, slides: [{ headline: 'A' }, { headline: 'B' }] };
        const p2 = { ...f.post, id: uid(), design: reel };
        await store.posts.insert(p2);
        expect((await store.posts.get(f.a.id, p2.id))?.design).toEqual(reel);
        await store.posts.update({ ...next, design: null, updatedAt: '2026-11-02T09:00:02.000Z' }, next.updatedAt);
        expect((await store.posts.get(f.a.id, f.post.id))?.design).toBeNull();
      } finally {
        await cleanup?.();
      }
    });

    it('transakce se při chybě vrátí', async () => {
      const { store, cleanup } = await make();
      try {
        const f = await fixture(store);
        await expect(
          store.tx(async (s) => {
            await s.clients.insert({ ...f.client, id: uid(), name: 'Dočasný' });
            throw new Error('boom');
          }),
        ).rejects.toThrow('boom');
        expect((await store.clients.list(f.a.id)).map((c) => c.name)).toEqual(['Klient A']);
      } finally {
        await cleanup?.();
      }
    });

    it('filtr postů podle termínu a stavu', async () => {
      const { store, cleanup } = await make();
      try {
        const f = await fixture(store);
        expect(await store.posts.list(f.a.id, { from: '2026-11-01T00:00:00.000Z', to: '2026-12-01T00:00:00.000Z' })).toHaveLength(1);
        expect(await store.posts.list(f.a.id, { from: '2026-12-01T00:00:00.000Z' })).toHaveLength(0);
        expect(await store.posts.list(f.a.id, { status: ['published'] })).toHaveLength(0);
        expect(await store.posts.list(f.a.id, { brandId: f.brand.id, status: ['draft'] })).toHaveLength(1);
      } finally {
        await cleanup?.();
      }
    });

    it('outbox: insertIfAbsent je idempotentní podle klíče', async () => {
      const { store, cleanup } = await make();
      try {
        const f = await fixture(store);
        const j1 = job(f, { idempotencyKey: `k-${uid()}` });
        const first = await store.publishJobs.insertIfAbsent(j1);
        const second = await store.publishJobs.insertIfAbsent({ ...j1, id: uid() });
        expect(second.id).toBe(first.id);
        expect(await store.publishJobs.listByPost(f.a.id, f.post.id)).toHaveLength(1);
      } finally {
        await cleanup?.();
      }
    });

    it('outbox: claimDue zamkne úlohu jen jednou a respektuje runAt', async () => {
      const { store, cleanup } = await make();
      try {
        const f = await fixture(store);
        await store.publishJobs.insertIfAbsent(job(f, { runAt: '2026-11-02T08:00:00.000Z' }));
        await store.publishJobs.insertIfAbsent(job(f, { runAt: '2026-11-03T08:00:00.000Z' }));
        const lock = '2026-11-02T09:02:00.000Z';
        const [c1, c2] = await Promise.all([store.publishJobs.claimDue(now, lock, 10), store.publishJobs.claimDue(now, lock, 10)]);
        const claimed = [...c1, ...c2];
        expect(claimed).toHaveLength(1);
        expect(claimed[0]).toMatchObject({ status: 'running', attempts: 1, lockedUntil: lock });
      } finally {
        await cleanup?.();
      }
    });

    it('schvalovací token se dohledá globálně', async () => {
      const { store, cleanup } = await make();
      try {
        const f = await fixture(store);
        const token = uid().replace(/-/g, '');
        await store.approvals.insert({
          id: uid(), agencyId: f.a.id, postId: f.post.id, postVersion: 1, token, status: 'pending', requestedBy: uid(),
          requestedAt: now, expiresAt: '2026-11-16T09:00:00.000Z', decidedAt: null, decidedByName: null, decidedByUserId: null, note: null,
        });
        expect((await store.approvals.getByToken(token))?.agencyId).toBe(f.a.id);
        expect(await store.approvals.listPending(f.b.id)).toEqual([]);
        expect(await store.approvals.listPending(f.a.id)).toHaveLength(1);
      } finally {
        await cleanup?.();
      }
    });

    it('metriky: upsert přepíše řádek (post, síť)', async () => {
      const { store, cleanup } = await make();
      try {
        const f = await fixture(store);
        const m = { agencyId: f.a.id, postId: f.post.id, brandId: f.brand.id, network: 'facebook' as const, reach: 1, impressions: 1, engagements: 1, clicks: 1, collectedAt: now };
        await store.metrics.upsert(m);
        await store.metrics.upsert({ ...m, reach: 50 });
        const rows = await store.metrics.listByBrand(f.a.id, f.brand.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.reach).toBe(50);
        expect(await store.metrics.listByBrand(f.b.id, f.brand.id)).toEqual([]);
      } finally {
        await cleanup?.();
      }
    });
  });
}
