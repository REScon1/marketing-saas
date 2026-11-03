import { describe, expect, it } from 'vitest';
import { seedDemo } from './seed.js';
import { makeTestApp, TestClock } from './testing/index.js';

describe('seed demo', () => {
  it('projde skutečnými službami a vytvoří všechny stavy postů', async () => {
    const clock = new TestClock(Date.parse('2026-11-02T12:00:00Z'));
    const real = clock.t;
    const { services: s } = makeTestApp({ clock });
    const r = await seedDemo(s, { set: (iso) => (iso ? clock.set(iso) : (clock.t = real)) }, new Date(real));
    const owner = await s.tenancy.resolveActor(r.personas[0]!.userId, r.agencyId);
    const posts = await s.content.listPosts(owner);
    const by = (st: string) => posts.filter((p) => p.status === st).length;
    expect(by('published')).toBe(15);
    expect(by('in_review')).toBe(2);
    expect(by('changes_requested')).toBe(1);
    expect(by('scheduled')).toBe(2);
    expect(by('approved')).toBe(1);
    expect(by('draft')).toBe(4);
    const client = await s.tenancy.resolveActor(r.personas[2]!.userId, r.agencyId);
    expect((await s.content.pendingApprovals(client)).length).toBe(1);
    // Většina ukázkových postů má návrh vizuálu (mix formátů) a ty pak nemají starou SVG ilustraci
    const designed = posts.filter((p) => p.design);
    expect(designed.length).toBeGreaterThanOrEqual(posts.length - 2);
    expect(new Set(designed.map((p) => p.design!.format))).toEqual(new Set(['image', 'carousel', 'reel']));
    expect(designed.every((p) => p.media.length === 0)).toBe(true);
    const brands = await s.catalog.listBrands(owner);
    const pek = brands.find((b) => b.name === 'Pekárna U Lípy')!;
    expect(pek.profile).toMatchObject({ color: '#c2410c', secondaryColor: '#3a1d0f', accentColor: '#f5c26b', fontHeading: 'Fraunces', fontBody: 'Onest' });
    expect(pek.profile.pillars.length).toBeGreaterThanOrEqual(3);
    expect(brands.find((b) => b.name === 'FitZóna')!.profile).toMatchObject({ fontHeading: 'Unbounded', fontBody: 'DM Sans', accentColor: '#d9f99d' });
    expect(brands.find((b) => b.name === 'Novák Stavby')!.profile).toMatchObject({ fontHeading: 'Archivo', fontBody: 'Manrope', color: '#1d4ed8' });
    const rep = await s.reports.monthly(owner, brands.find((b) => b.name === 'FitZóna')!.id, '2026-10');
    expect(rep.totals.posts).toBeGreaterThan(0);
    expect(rep.totals.reach).toBeGreaterThan(0);
  });
});
