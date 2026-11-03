import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loading } from '../components/ui';
import { useAction, useApi, useBrandFilter, useData } from '../lib/app';
import { useCatalog } from '../lib/hooks';
import { useReveal } from '../lib/motion';
import { FeedGrid } from '../studio/preview';

/** Plánování mřížky Instagram profilu: jak bude profil vypadat po publikaci naplánovaných postů. */
export function Feed() {
  const api = useApi();
  const nav = useNavigate();
  const { run } = useAction();
  const { brands } = useCatalog();
  const { brandId: globalBrand } = useBrandFilter();
  const [brandId, setBrandId] = useState('');
  useEffect(() => {
    if (globalBrand) setBrandId(globalBrand);
    else if (!brandId && brands[0]) setBrandId(brands[0].id);
  }, [brands, globalBrand, brandId]);
  const brand = brands.find((b) => b.id === brandId);
  const posts = useData(() => (brandId ? api.call('content.listPosts', { brandId }) : Promise.resolve([])), [brandId]);
  useReveal(!!posts.data && !!brand);

  // Nejnovější nahoře: naplánované a rozpracované (s termínem) nad publikovanými, jako to uvidí lidé na profilu.
  const items = useMemo(
    () =>
      (posts.data ?? [])
        .filter((p) => p.networks.includes('instagram') && (p.design || p.media.length) && (p.publishedAt || p.scheduledAt))
        .sort((a, b) => (b.publishedAt ?? b.scheduledAt!).localeCompare(a.publishedAt ?? a.scheduledAt!)),
    [posts.data],
  );

  if (!brand || !posts.data) return <Loading />;
  const upcoming = items.filter((p) => p.status !== 'published');

  async function reorder(ids: string[]) {
    // Prohození termínů: nová pozice v mřížce = termín, který na ní byl.
    const slots = upcoming.map((p) => p.scheduledAt!).sort((a, b) => b.localeCompare(a));
    const moved = ids.filter((id) => upcoming.some((p) => p.id === id));
    await run(async () => {
      for (const [i, id] of moved.entries()) {
        const p = upcoming.find((x) => x.id === id)!;
        if (slots[i] && slots[i] !== p.scheduledAt) await api.call('content.updatePost', id, { scheduledAt: slots[i] });
      }
    }, 'Pořadí upraveno, termíny se prohodily');
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{'Mřížka\nprofilu'}</h1>
          <div className="sub">Jak bude Instagram {brand.name} vypadat po publikaci. Přetažením prohodíte termíny.</div>
        </div>
        <div className="actions">
          <select id="feed-brand" className="select pill" value={brandId} onChange={(e) => setBrandId(e.target.value)} aria-label="Značka">
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>
      <section className="panel card-pad feed-wrap">
        <FeedGrid
          brand={brand}
          posts={items.map((p) => ({ id: p.id, design: p.design, media: p.media, status: p.status, publishedAt: p.publishedAt, scheduledAt: p.scheduledAt }))}
          stats={{ posts: items.length + 120, followers: 4820, following: 312 }}
          onOpen={(id: string) => nav(`/posty/${id}`)}
          onReorder={(ids: string[]) => void reorder(ids)}
        />
      </section>
    </>
  );
}
