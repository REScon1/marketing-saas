import { storeContract } from '@ms/core/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb } from './testing/pg.js';

let db: Awaited<ReturnType<typeof makeTestDb>>;
beforeAll(async () => {
  db = await makeTestDb();
});
afterAll(async () => {
  await db?.cleanup();
});

// Kontrakt dostane pro každý test čerstvé schéma: claimDue/listUnknown běží napříč agenturami,
// takže sdílená data mezi testy by se navzájem ovlivňovala.
storeContract('postgres', async () => {
  const fresh = await makeTestDb();
  return { store: fresh.store, cleanup: fresh.cleanup };
});

describe('PgStore: specifika Postgresu', () => {
  const now = '2026-11-02T09:00:00.123Z';
  const uid = () => crypto.randomUUID();

  async function agencyWithPost() {
    const s = db.store;
    const a = { id: uid(), name: 'A', slug: `a-${uid()}`, plan: 'pilot' as const, createdAt: now };
    await s.agencies.insert(a);
    const c = { id: uid(), agencyId: a.id, name: 'Č', contactEmail: null, archived: false, createdAt: now };
    await s.clients.insert(c);
    const b = {
      id: uid(), agencyId: a.id, clientId: c.id, name: 'B', requiresClientApproval: true, archived: false, createdAt: now,
      profile: { tone: 't', audience: '', bannedWords: ['x'], examples: [], defaultHashtags: ['#a'], maxHashtags: 3, languages: ['cs' as const], emoji: 'few' as const, color: '#000000' },
    };
    await s.brands.insert(b);
    const p = {
      id: uid(), agencyId: a.id, brandId: b.id, clientId: c.id, title: 'T', body: 'B', overrides: { instagram: 'IG' }, networks: ['facebook' as const, 'instagram' as const],
      media: [{ id: 'm1', kind: 'image' as const, url: 'https://x.example/a.png', alt: 'alt' }], status: 'draft' as const, scheduledAt: null, publishedAt: null, version: 1,
      versions: [{ n: 1, body: 'B', networks: ['facebook' as const], createdAt: now, createdBy: 'u' }], aiAssisted: true, createdBy: 'u', createdAt: now, updatedAt: now,
    };
    await s.posts.insert(p);
    return { a, c, b, p };
  }

  it('převod řádek <-> doména je bezeztrátový včetně milisekund a JSON polí', async () => {
    const { a, b, p } = await agencyWithPost();
    expect(await db.store.posts.get(a.id, p.id)).toEqual(p);
    expect(await db.store.brands.get(a.id, b.id)).toEqual(b);
    // optimistický zámek porovnává přesně stejný řetězec
    await db.store.posts.update({ ...p, title: 'X', updatedAt: '2026-11-02T09:00:00.124Z' }, p.updatedAt);
    expect((await db.store.posts.get(a.id, p.id))?.updatedAt).toBe('2026-11-02T09:00:00.124Z');
  });

  it('insert s existujícím id -> conflict, update neexistujícího -> not_found', async () => {
    const { a, c, p } = await agencyWithPost();
    await expect(db.store.clients.insert(c)).rejects.toMatchObject({ code: 'conflict' });
    await expect(db.store.clients.update({ ...c, id: uid() })).rejects.toMatchObject({ code: 'not_found' });
    await expect(db.store.posts.update({ ...p, id: uid() }, p.updatedAt)).rejects.toMatchObject({ code: 'not_found' });
    await expect(db.store.memberships.delete(a.id, uid())).rejects.toMatchObject({ code: 'not_found' });
  });

  it('e-mail je unikátní bez ohledu na velikost písmen', async () => {
    const email = `X-${uid()}@Example.cz`;
    await db.store.users.insert({ id: uid(), email, name: 'X', createdAt: now });
    await expect(db.store.users.insert({ id: uid(), email: email.toLowerCase(), name: 'Y', createdAt: now })).rejects.toMatchObject({ code: 'conflict' });
    expect((await db.store.users.getByEmail(email.toUpperCase()))?.name).toBe('X');
  });

  it('klienti jsou seřazení česky', async () => {
    const a = { id: uid(), name: 'A', slug: `a-${uid()}`, plan: 'pilot' as const, createdAt: now };
    await db.store.agencies.insert(a);
    for (const name of ['Zdeněk', 'Chata', 'Čáp', 'Hora', 'Šimon', 'Sára', 'ahoj']) {
      await db.store.clients.insert({ id: uid(), agencyId: a.id, name, contactEmail: null, archived: false, createdAt: now });
    }
    const names = (await db.store.clients.list(a.id)).map((c) => c.name);
    expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y, 'cs')));
    expect(names).toEqual(['ahoj', 'Čáp', 'Hora', 'Chata', 'Sára', 'Šimon', 'Zdeněk']);
  });

  it('vnořená tx používá stejnou transakci a rollback vrátí obojí', async () => {
    const { a, c } = await agencyWithPost();
    await expect(
      db.store.tx(async (s) => {
        await s.clients.insert({ ...c, id: uid(), name: 'vnější' });
        await db.store.tx(async (s2) => {
          await s2.clients.insert({ ...c, id: uid(), name: 'vnořená' });
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect((await db.store.clients.list(a.id)).map((x) => x.name)).toEqual(['Č']);
  });

  it('cizí klíče jsou složené s agency_id: post nemůže odkazovat na značku jiné agentury', async () => {
    const one = await agencyWithPost();
    const two = await agencyWithPost();
    await expect(db.store.posts.insert({ ...one.p, id: uid(), agencyId: two.a.id })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('RLS: nevlastnická role vidí jen řádky agentury z app.agency_id; worker funkce fungují napříč', async () => {
    const one = await agencyWithPost();
    const two = await agencyWithPost();
    const role = `${db.schema}_app`;
    const c = await db.pool.connect();
    try {
      await c.query(`create role ${role} nologin`);
      await c.query(`grant usage on schema ${db.schema} to ${role}`);
      await c.query(`grant select, insert, update, delete on all tables in schema ${db.schema} to ${role}`);
      await c.query('begin');
      await c.query(`set local role ${role}`);
      await c.query(`select set_config('app.agency_id', $1, true)`, [one.a.id]);
      const posts = await c.query('select id from posts');
      expect(posts.rows.map((r) => r.id)).toEqual([one.p.id]);
      await expect(c.query('update posts set title = $1 where id = $2 returning id', ['hack', two.p.id])).resolves.toMatchObject({ rowCount: 0 });
      await c.query('rollback');

      await c.query('begin');
      await c.query(`set local role ${role}`);
      // bez app.agency_id role nevidí nic
      expect((await c.query('select count(*)::int as n from posts')).rows[0].n).toBe(0);
      await c.query('rollback');
    } finally {
      await c.query('reset role').catch(() => {});
      await c.query(`drop owned by ${role}`).catch(() => {});
      await c.query(`drop role if exists ${role}`).catch(() => {});
      c.release();
    }
  });
});
