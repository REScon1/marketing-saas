import { NETWORKS, type Network, type Post, type PostStatus } from '@ms/core';
import { CalendarCheck2, CalendarX2, ChevronLeft, ChevronRight, Clock4, GripVertical, Hourglass, Plus, Send } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Flip, gsap, reduced, useReveal } from '../lib/motion';
import { CountUp } from '../components/ui';
import { useNavigate } from 'react-router-dom';
import { Empty, Loading, NetworkIcon, StatusBadge } from '../components/ui';
import { isStaffRole, useAction, useApi, useBrandFilter, useData, useSession } from '../lib/app';
import { fmtInt, fmtTime, fromLocalInput, NETWORK_LABEL, pragueDay, STATUS_LABEL, toLocalInput } from '../lib/format';
import { useCatalog } from '../lib/hooks';
import { Stat, Thumb } from './Dashboard';

const WEEKDAYS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
const MONTHS = ['Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen', 'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec'];
type View = 'week' | 'month' | 'list';
type StatusGroup = 'scheduled' | 'waiting' | 'published' | 'draft' | 'problem';
const GROUPS: { key: StatusGroup; label: string; statuses: PostStatus[]; color: string }[] = [
  { key: 'scheduled', label: 'Naplánováno', statuses: ['scheduled', 'publishing', 'approved'], color: 'var(--sched)' },
  { key: 'waiting', label: 'Čeká na schválení', statuses: ['in_review'], color: 'var(--wait)' },
  { key: 'published', label: 'Publikováno', statuses: ['published'], color: 'var(--pub)' },
  { key: 'draft', label: 'Koncepty', statuses: ['draft'], color: 'var(--draft)' },
  { key: 'problem', label: 'Potřebuje pozornost', statuses: ['changes_requested', 'failed'], color: 'var(--bad)' },
];

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));

export function CalendarPage() {
  const api = useApi();
  const { actor } = useSession();
  const staff = isStaffRole(actor.role);
  const nav = useNavigate();
  const { brandId } = useBrandFilter();
  const { brandById, brands } = useCatalog();
  const { run } = useAction();
  const today = pragueDay(new Date().toISOString());
  const [view, setView] = useState<View>('month');
  const [anchor, setAnchor] = useState(today);
  const [net, setNet] = useState<Network | ''>('');
  const [groups, setGroups] = useState<Set<StatusGroup>>(new Set(GROUPS.map((g) => g.key)));
  const [dropDay, setDropDay] = useState<string | null>(null);

  const posts = useData(() => api.call('content.listPosts', brandId ? { brandId } : {}), [brandId]);
  const ov = useData(() => api.call('reports.overview', brandId ? { brandId } : {}), [brandId]);
  useReveal(!!posts.data);

  // Přepnutí Týden / Měsíc / Seznam: bloky se přelijí na nové místo (Flip), nové naběhnou, staré zmizí.
  const flipState = useRef<ReturnType<typeof Flip.getState> | null>(null);
  const shiftDir = useRef(0);
  const switchView = (v: View) => {
    if (v === view) return;
    if (!reduced()) flipState.current = Flip.getState(document.querySelectorAll('.cal-layout [data-flip-id]'));
    setView(v);
  };
  useLayoutEffect(() => {
    if (!flipState.current) return;
    Flip.from(flipState.current, {
      duration: 0.7, ease: 'power3.inOut', absolute: true, scale: true, nested: true, stagger: 0.006,
      onEnter: (els) => gsap.fromTo(els, { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: 0.45, delay: 0.25, ease: 'power3.out' }),
      onLeave: (els) => gsap.to(els, { opacity: 0, scale: 0.9, duration: 0.25 }),
    });
    flipState.current = null;
  }, [view]);
  // Změna měsíce/týdne: dny přijedou ze strany, kterou jste šli.
  useLayoutEffect(() => {
    const dir = shiftDir.current;
    shiftDir.current = 0;
    if (!dir || reduced()) return;
    gsap.fromTo('.cal > .cal-d, .week > .cal-d', { opacity: 0, x: 24 * dir }, { opacity: 1, x: 0, duration: 0.5, stagger: 0.008, ease: 'power3.out', clearProps: 'transform,opacity' });
  }, [anchor]);

  const visible = useMemo(() => {
    const allowed = new Set(GROUPS.filter((g) => groups.has(g.key)).flatMap((g) => g.statuses));
    return (posts.data ?? []).filter((p) => allowed.has(p.status) && (!net || p.networks.includes(net)));
  }, [posts.data, groups, net]);

  const byDay = useMemo(() => {
    const m = new Map<string, Post[]>();
    for (const p of visible) {
      const at = p.publishedAt ?? p.scheduledAt;
      if (!at) continue;
      const k = pragueDay(at);
      m.set(k, [...(m.get(k) ?? []), p].sort((a, b) => (a.publishedAt ?? a.scheduledAt!).localeCompare(b.publishedAt ?? b.scheduledAt!)));
    }
    return m;
  }, [visible]);

  const unscheduled = (posts.data ?? []).filter((p) => !p.scheduledAt && ['draft', 'changes_requested', 'approved'].includes(p.status));

  const y = Number(anchor.slice(0, 4));
  const mo = Number(anchor.slice(5, 7)) - 1;
  const monthDays = useMemo(() => {
    const first = `${anchor.slice(0, 7)}-01`;
    const start = mondayOf(first);
    const daysInMonth = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const lead = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
    const n = Math.ceil((lead + daysInMonth) / 7) * 7;
    return Array.from({ length: n }, (_, i) => addDays(start, i));
  }, [anchor, y, mo]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(mondayOf(anchor), i)), [anchor]);

  function shift(dir: number) {
    shiftDir.current = dir;
    if (view === 'week') setAnchor(addDays(anchor, 7 * dir));
    else {
      const d = new Date(Date.UTC(y, mo + dir, 1));
      setAnchor(d.toISOString().slice(0, 10));
    }
  }

  async function moveTo(postId: string, day: string) {
    const p = posts.data?.find((x) => x.id === postId);
    if (!p || day < today) return;
    const time = p.scheduledAt ? toLocalInput(p.scheduledAt).slice(11) : '10:00';
    const iso = fromLocalInput(`${day}T${time}`);
    if (!iso || iso === p.scheduledAt) return;
    await run(() => api.call('content.updatePost', p.id, { scheduledAt: iso }), `„${p.title}“ přesunuto na ${Number(day.slice(8))}. ${Number(day.slice(5, 7))}.`);
  }

  const dnd = (day: string) =>
    staff && day >= today
      ? {
          onDragOver: (e: DragEvent) => { e.preventDefault(); setDropDay(day); },
          onDragLeave: () => setDropDay((d) => (d === day ? null : d)),
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            setDropDay(null);
            const id = e.dataTransfer.getData('text/plain');
            if (id) void moveTo(id, day);
          },
        }
      : {};

  const o = ov.data;
  const title = view === 'week' ? `${Number(weekDays[0]!.slice(8))}. ${Number(weekDays[0]!.slice(5, 7))}. – ${Number(weekDays[6]!.slice(8))}. ${Number(weekDays[6]!.slice(5, 7))}. ${weekDays[6]!.slice(0, 4)}` : `${MONTHS[mo]} ${y}`;
  const monthCount = visible.filter((p) => (p.publishedAt ?? p.scheduledAt ?? '').slice(0, 7) === anchor.slice(0, 7)).length;
  const monthBrands = new Set(visible.filter((p) => (p.publishedAt ?? p.scheduledAt ?? '').slice(0, 7) === anchor.slice(0, 7)).map((p) => p.brandId)).size;

  return (
    <>
      <div className="page-head">
        <h1>{'Publikační\nkalendář'}</h1>
        <div className="stats">
          <Stat icon={<CalendarCheck2 size={16} />} num={<CountUp value={o?.scheduledThisWeek ?? null} format={fmtInt} />} label="naplánováno tento týden" />
          <Stat icon={<Hourglass size={16} />} num={<CountUp value={o?.awaitingApproval ?? null} format={fmtInt} />} label="čeká na schválení" />
          <Stat icon={<Send size={16} />} num={<CountUp value={o?.publishedThisWeek ?? null} format={fmtInt} />} label="publikováno tento týden" />
          <Stat icon={<CalendarX2 size={16} />} num={<CountUp value={o?.emptyDaysNext14 ?? null} format={fmtInt} />} label="prázdných dní v příštích 14" />
        </div>
        <div className="actions">
          <div className="seg" role="tablist" aria-label="Zobrazení">
            {(['week', 'month', 'list'] as View[]).map((v) => (
              <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => switchView(v)}>{{ week: 'Týden', month: 'Měsíc', list: 'Seznam' }[v]}</button>
            ))}
          </div>
          <button className="btn" onClick={() => shift(-1)} aria-label="Předchozí"><ChevronLeft size={16} /></button>
          <button className="btn" onClick={() => setAnchor(today)}>Dnes</button>
          <button className="btn" onClick={() => shift(1)} aria-label="Další"><ChevronRight size={16} /></button>
          {staff && <button className="btn primary" onClick={() => nav('/posty/novy')}><Plus size={16} /> Nový post</button>}
        </div>
      </div>

      <div className="filters">
        <button className={`chip ${!net ? 'on' : ''}`} onClick={() => setNet('')}>Všechny sítě</button>
        {NETWORKS.map((n) => (
          <button key={n} className={`chip ${net === n ? 'on' : ''}`} onClick={() => setNet(net === n ? '' : n)} aria-label={NETWORK_LABEL[n]} title={NETWORK_LABEL[n]}>
            <NetworkIcon network={n} size={14} />
          </button>
        ))}
        <span className="vsep" />
        {GROUPS.filter((g) => staff || g.key !== 'draft').map((g) => {
          const on = groups.has(g.key);
          return (
            <button key={g.key} className="chip" aria-pressed={on} style={on ? {} : { opacity: 0.45 }}
              onClick={() => setGroups((s) => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}>
              <span className="sdot" style={{ background: g.color }} /> {g.label}
            </button>
          );
        })}
        {brandId && <span className="small muted">· jen {brandById.get(brandId)?.name}</span>}
      </div>

      {!posts.data ? <Loading /> : (
        <div className="cal-layout">
          <section className="panel card-pad">
            <div className="row" style={{ marginBottom: 14 }}>
              <div>
                <h2 style={{ fontSize: 20 }}>{title}</h2>
                {view !== 'week' && <div className="small muted">{monthCount} postů · {monthBrands} {monthBrands === 1 ? 'značka' : monthBrands < 5 ? 'značky' : 'značek'}</div>}
              </div>
              {staff && <span className="small muted" style={{ marginLeft: 'auto' }}>Přetažením přesunete post na jiný den.</span>}
            </div>

            {view === 'month' && (
              <div className="cal">
                {WEEKDAYS.map((d) => <div key={d} className="cal-h">{d}</div>)}
                {monthDays.map((day) => {
                  const items = byDay.get(day) ?? [];
                  const out = Number(day.slice(5, 7)) - 1 !== mo;
                  return (
                    <div key={day} className={`cal-d ${out ? 'out' : ''} ${day < today ? 'past' : ''} ${day === today ? 'today' : ''} ${dropDay === day ? 'drop' : ''} ${items.length ? '' : 'empty-day'}`} {...dnd(day)}>
                      <div className="num">
                        <span>{Number(day.slice(8))}</span>
                        {staff && day >= today && <button className="add" onClick={() => nav(`/posty/novy?den=${day}`)} aria-label={`Nový post na ${day}`}><Plus size={14} /></button>}
                      </div>
                      {items.slice(0, 3).map((p) => <Block key={p.id} post={p} staff={staff} onOpen={() => nav(`/posty/${p.id}`)} brandColor={brandById.get(p.brandId)?.profile.color} />)}
                      {items.length > 3 && <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => { setAnchor(day); switchView('week'); }}>+{items.length - 3} další</button>}
                    </div>
                  );
                })}
              </div>
            )}

            {view === 'week' && (
              <div className="week">
                {weekDays.map((day, i) => {
                  const items = byDay.get(day) ?? [];
                  return (
                    <div key={day} className={`cal-d ${day < today ? 'past' : ''} ${day === today ? 'today' : ''} ${dropDay === day ? 'drop' : ''} ${items.length ? '' : 'empty-day'}`} {...dnd(day)}>
                      <div className="num"><span>{WEEKDAYS[i]} {Number(day.slice(8))}.</span>
                        {staff && day >= today && <button className="add" onClick={() => nav(`/posty/novy?den=${day}`)} aria-label={`Nový post na ${day}`}><Plus size={14} /></button>}
                      </div>
                      {items.map((p) => <Block key={p.id} post={p} staff={staff} big onOpen={() => nav(`/posty/${p.id}`)} brandColor={brandById.get(p.brandId)?.profile.color} />)}
                    </div>
                  );
                })}
              </div>
            )}

            {view === 'list' && (
              <ListView days={[...byDay.keys()].filter((d) => d.slice(0, 7) === anchor.slice(0, 7)).sort()} byDay={byDay} brandById={brandById} />
            )}
          </section>

          <aside className="stack" style={{ gap: 18 }}>
            <section className="panel card-pad">
              <div className="row" style={{ marginBottom: 10 }}>
                <h2>{MONTHS[mo]} {y}</h2>
                <span style={{ marginLeft: 'auto' }} className="row">
                  <button className="btn ghost sm" onClick={() => setAnchor(new Date(Date.UTC(y, mo - 1, 1)).toISOString().slice(0, 10))} aria-label="Předchozí měsíc"><ChevronLeft size={14} /></button>
                  <button className="btn ghost sm" onClick={() => setAnchor(new Date(Date.UTC(y, mo + 1, 1)).toISOString().slice(0, 10))} aria-label="Další měsíc"><ChevronRight size={14} /></button>
                </span>
              </div>
              <div className="mini">
                {WEEKDAYS.map((d) => <span key={d} className="h">{d}</span>)}
                {monthDays.map((day) => (
                  <button key={day} className={`${Number(day.slice(5, 7)) - 1 !== mo ? 'out' : ''} ${day === today ? 'today' : ''} ${byDay.has(day) ? 'has' : ''}`}
                    onClick={() => { setAnchor(day); switchView('week'); }} aria-label={`Týden s ${day}`}>
                    {Number(day.slice(8))}
                  </button>
                ))}
              </div>
            </section>

            {staff && (
              <section className="panel card-pad">
                <div className="row" style={{ marginBottom: 4 }}>
                  <h2>Nenaplánované</h2>
                  <span className="badge" style={{ marginLeft: 'auto' }}>{unscheduled.length}</span>
                </div>
                <p className="small muted" style={{ marginBottom: 12 }}>Přetáhněte post do kalendáře a dostane termín.</p>
                {unscheduled.length ? (
                  <div className="drafts">
                    {unscheduled.map((p) => (
                      <div key={p.id} className="draft-item" draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; }}
                        onClick={() => nav(`/posty/${p.id}`)} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && nav(`/posty/${p.id}`)}>
                        <span className="grip"><GripVertical size={15} /></span>
                        <Thumb post={p} brand={brandById.get(p.brandId)} />
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <span className="small strong clamp1" style={{ display: 'block' }}>{p.title}</span>
                          <span className="small muted">{brandById.get(p.brandId)?.name} · {STATUS_LABEL[p.status]}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : <div className="small muted">Všechno má termín.</div>}
              </section>
            )}
            {brands.length === 0 && <Empty title="Zatím žádné značky" />}
          </aside>
        </div>
      )}
    </>
  );
}

function Block({ post: p, staff, big, onOpen, brandColor }: { post: Post; staff: boolean; big?: boolean; onOpen(): void; brandColor?: string }) {
  const draggable = staff && !['published', 'publishing'].includes(p.status);
  const at = p.publishedAt ?? p.scheduledAt!;
  return (
    <div className={`block b-${p.status} ${big ? 'big' : ''}`} data-flip-id={p.id} draggable={draggable} role="link" tabIndex={0}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()} title={`${p.title} · ${STATUS_LABEL[p.status]}`}>
      {big && p.media[0] && <img src={p.media[0].url} alt="" loading="lazy" />}
      <span className="time"><span className="brand-dot" style={{ background: brandColor, width: 7, height: 7 }} />{fmtTime(at)}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 3 }}>{p.networks.map((n) => <NetworkIcon key={n} network={n} size={10} />)}</span>
      </span>
      <span className="t">{p.title}</span>
      {big && <span className="small muted">{STATUS_LABEL[p.status]}</span>}
    </div>
  );
}

function ListView({ days, byDay, brandById }: { days: string[]; byDay: Map<string, Post[]>; brandById: Map<string, { name: string; profile: { color: string } }> }) {
  const nav = useNavigate();
  if (!days.length) return <Empty title="V tomto měsíci nic není" />;
  return (
    <div className="table-wrap">
      {days.map((d) => (
        <div key={d}>
          <div className="listday">{new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`))}</div>
          <table className="table">
            <tbody>
              {byDay.get(d)!.map((p) => (
                <tr key={p.id} className="click" onClick={() => nav(`/posty/${p.id}`)}>
                  <td style={{ width: 70 }} className="mono small">{fmtTime(p.publishedAt ?? p.scheduledAt!)}</td>
                  <td><div className="row" style={{ flexWrap: 'nowrap' }} data-flip-id={p.id}><Thumb post={p} brand={brandById.get(p.brandId)} /><span style={{ minWidth: 0 }}><span className="strong clamp1" style={{ display: 'block' }}>{p.title}</span><span className="small muted">{brandById.get(p.brandId)?.name}</span></span></div></td>
                  <td style={{ width: 90 }}><span className="row" style={{ gap: 4, color: 'var(--muted)' }}>{p.networks.map((n) => <NetworkIcon key={n} network={n} />)}</span></td>
                  <td style={{ width: 160 }}><StatusBadge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
