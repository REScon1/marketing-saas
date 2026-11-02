import type { Post } from '@ms/core';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loading, PageHead, STATUS_COLOR } from '../components/ui';
import { isStaffRole, useApi, useData, useSession } from '../lib/app';
import { fmtTime, pragueDay, STATUS_LABEL } from '../lib/format';
import { useCatalog } from '../lib/hooks';

const WEEKDAYS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
const MONTHS = ['Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen', 'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec'];

export function CalendarPage() {
  const api = useApi();
  const { actor } = useSession();
  const staff = isStaffRole(actor.role);
  const nav = useNavigate();
  const { brands, brandById } = useCatalog();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [brandFilter, setBrandFilter] = useState<string>('');

  const grid = useMemo(() => {
    const first = new Date(Date.UTC(cursor.y, cursor.m, 1));
    const startDow = (first.getUTCDay() + 6) % 7;
    const start = new Date(Date.UTC(cursor.y, cursor.m, 1 - startDow));
    const days = Math.ceil((startDow + new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate()) / 7) * 7;
    return Array.from({ length: days }, (_, i) => new Date(start.getTime() + i * 864e5).toISOString().slice(0, 10));
  }, [cursor]);

  const from = new Date(Date.parse(`${grid[0]}T00:00:00Z`) - 864e5).toISOString();
  const to = new Date(Date.parse(`${grid.at(-1)}T00:00:00Z`) + 2 * 864e5).toISOString();
  const posts = useData(() => api.call('content.listPosts', { from, to, ...(brandFilter ? { brandId: brandFilter } : {}) }), [from, to, brandFilter]);

  const byDay = useMemo(() => {
    const m = new Map<string, Post[]>();
    for (const p of posts.data ?? []) {
      if (!p.scheduledAt) continue;
      const k = pragueDay(p.publishedAt ?? p.scheduledAt);
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return m;
  }, [posts.data]);

  const today = pragueDay(new Date().toISOString());
  const shift = (d: number) => setCursor((c) => {
    const n = new Date(Date.UTC(c.y, c.m + d, 1));
    return { y: n.getUTCFullYear(), m: n.getUTCMonth() };
  });

  return (
    <>
      <PageHead
        title="Kalendář obsahu"
        sub={`${MONTHS[cursor.m]} ${cursor.y}`}
        actions={
          <>
            <select className="select" style={{ width: 200 }} value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} aria-label="Značka">
              <option value="">Všechny značky</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button className="btn" onClick={() => shift(-1)} aria-label="Předchozí měsíc"><ChevronLeft size={16} /></button>
            <button className="btn" onClick={() => setCursor({ y: new Date().getFullYear(), m: new Date().getMonth() })}>Dnes</button>
            <button className="btn" onClick={() => shift(1)} aria-label="Další měsíc"><ChevronRight size={16} /></button>
            {staff && <button className="btn primary" onClick={() => nav('/posty/novy')}><Plus size={16} /> Nový post</button>}
          </>
        }
      />
      <div className="row small muted" style={{ marginBottom: 10, gap: 14 }}>
        {(['draft', 'in_review', 'changes_requested', 'approved', 'scheduled', 'published', 'failed'] as const)
          .filter((s) => staff || s !== 'draft')
          .map((s) => (
            <span key={s} className="row" style={{ gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[s], display: 'inline-block' }} />{STATUS_LABEL[s]}</span>
          ))}
      </div>
      {!posts.data && posts.loading ? (
        <Loading />
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="cal">
            {WEEKDAYS.map((d) => <div key={d} className="cal-h">{d}</div>)}
            {grid.map((day) => {
              const items = byDay.get(day) ?? [];
              const out = Number(day.slice(5, 7)) - 1 !== cursor.m;
              return (
                <div key={day} className={`cal-d ${out ? 'out' : ''} ${day === today ? 'today' : ''} ${items.length ? '' : 'empty-day'}`}>
                  <div className="num">
                    <span>{Number(day.slice(8))}.</span>
                    {staff && day >= today && (
                      <button className="add" onClick={() => nav(`/posty/novy?den=${day}`)} aria-label={`Nový post ${day}`}><Plus size={14} /></button>
                    )}
                  </div>
                  {items.map((p) => {
                    const b = brandById.get(p.brandId);
                    return (
                      <div key={p.id} className="cal-item" onClick={() => nav(`/posty/${p.id}`)} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && nav(`/posty/${p.id}`)} title={`${p.title} · ${STATUS_LABEL[p.status]}`} style={{ borderLeft: `3px solid ${b?.profile.color ?? 'var(--line)'}` }}>
                        <span className="sdot" style={{ background: STATUS_COLOR[p.status] }} />
                        <span className="time">{fmtTime(p.publishedAt ?? p.scheduledAt!)}</span>
                        <span className="t">{p.title}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
