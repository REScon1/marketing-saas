import type { Brand, Post } from '@ms/core';
import { AlertTriangle, ArrowUpRight, CalendarClock, Check, Clock, Eye, Plus, RotateCcw, Send, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAmbient } from '../components/Ambient';
import { CountUp, Empty, Loading, StatusBadge } from '../components/ui';
import { useReveal } from '../lib/motion';
import { useAction, useApi, useBrandFilter, useData, useSession } from '../lib/app';
import { fmtDayShort, fmtInt, fmtNum, fmtPct, fmtTime, greeting, relative } from '../lib/format';
import { useCatalog } from '../lib/hooks';

export function Dashboard() {
  const api = useApi();
  const { actor } = useSession();
  const nav = useNavigate();
  const { brandId } = useBrandFilter();
  const { brandById } = useCatalog();
  const posts = useData(() => api.call('content.listPosts', brandId ? { brandId } : {}), [brandId]);
  const ov = useData(() => api.call('reports.overview', brandId ? { brandId } : {}), [brandId]);
  const pending = useData(() => api.call('content.pendingApprovals'), []);
  const activity = useData(() => api.call('content.activity', { limit: 8 }), []);
  const now = useNow();

  const derived = useMemo(() => {
    const all = posts.data ?? [];
    const nowIso = new Date(now).toISOString();
    const upcoming = all
      .filter((p) => p.scheduledAt && p.scheduledAt >= nowIso && ['scheduled', 'approved', 'in_review', 'draft', 'changes_requested'].includes(p.status))
      .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!));
    const next = upcoming.find((p) => p.status !== 'draft') ?? upcoming[0];
    return {
      next,
      coming: upcoming.filter((p) => p !== next).slice(0, 8),
      attention: all.filter((p) => ['changes_requested', 'failed', 'approved'].includes(p.status)),
    };
  }, [posts.data, now]);
  useReveal(!!posts.data);
  useAmbient(derived.next?.media[0]?.url);

  if (!posts.data) return <Loading />;
  const { next, coming, attention } = derived;
  const pend = (pending.data ?? []).filter((x) => !brandId || x.post.brandId === brandId);
  const o = ov.data;
  const reachDelta = o && o.reach30Prev ? (o.reach30 - o.reach30Prev) / o.reach30Prev : null;

  const needs: NeedItem[] = [
    ...attention.filter((p) => p.status === 'failed').map((p) => ({ post: p, kind: 'failed' as const })),
    ...attention.filter((p) => p.status === 'changes_requested').map((p) => ({ post: p, kind: 'changes' as const })),
    ...attention.filter((p) => p.status === 'approved').map((p) => ({ post: p, kind: 'schedule' as const })),
    ...pend.map((x) => ({ post: x.post, kind: 'waiting' as const, since: x.approval.requestedAt })),
  ];

  return (
    <>
      <div className="page-head">
        <h1>{greeting(actor.name)}</h1>
        <div className="stats">
          <Stat icon={<Users size={16} />} num={<CountUp value={o?.reach30 ?? null} format={fmtNum} />} label="dosah za 30 dní" trend={reachDelta} />
          <Stat icon={<Eye size={16} />} num={<CountUp value={o?.engagementRate30 ?? null} format={fmtPct} />} label="míra zapojení, 30 dní" />
          <Stat icon={<CalendarClock size={16} />} num={<CountUp value={o?.goingOutThisWeek ?? null} format={fmtInt} />} label="postů vyjde tento týden" />
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => nav('/posty/novy')}><Plus size={16} /> Nový post</button>
        </div>
      </div>

      <div className="split">
        <section className="panel">
          <div className="card-head">
            <h2>Na řadě</h2>
            <span className="live" style={{ marginLeft: 'auto' }}>Živá fronta</span>
            <Link to="/kalendar" className="icon-btn" style={{ width: 32, height: 32, boxShadow: 'none' }} aria-label="Kalendář"><ArrowUpRight size={15} /></Link>
          </div>
          <div style={{ padding: '0 20px 20px' }} className="stack">
            {next ? <UpNext post={next} brand={brandById.get(next.brandId)} now={now} /> : <Empty title="Nic není naplánované">Založte první post tlačítkem Nový post.</Empty>}
            {coming.length > 0 && (
              <>
                <div className="section-label" style={{ marginTop: 6 }}>Brzy</div>
                <div className="coming">
                  {coming.map((p) => (
                    <Link key={p.id} to={`/posty/${p.id}`}>
                      <Thumb post={p} brand={brandById.get(p.brandId)} />
                      <span className="meta">
                        <span className="small strong clamp1">{p.title}</span>
                        <span className="small muted">{fmtDayShort(p.scheduledAt!)} · {fmtTime(p.scheduledAt!)}</span>
                      </span>
                      <StatusBadge status={p.status} />
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>

        <aside className="stack" style={{ gap: 18 }}>
          <section className="panel">
            <div className="card-head">
              <h2>Potřebuje vás</h2>
              {needs.length > 0 && <span className="count-badge" style={{ marginLeft: 'auto' }}>{needs.length}</span>}
            </div>
            <NeedsList items={needs} brandById={brandById} />
          </section>
          <section className="panel">
            <div className="card-head"><h2>Poslední aktivita</h2></div>
            <div className="timeline" style={{ padding: '0 20px 18px' }}>
              {(activity.data ?? []).map((e) => (
                <div key={e.id} className="ev">
                  <span className="t">{relative(e.createdAt)}</span>
                  <span><strong>{e.actorName}</strong> {ACTION_LABEL[e.action] ?? e.action}</span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function Stat({ icon, num, label, trend }: { icon: React.ReactNode; num: React.ReactNode; label: string; trend?: number | null }) {
  return (
    <div className="stat">
      <span className="ico">{icon}</span>
      <div>
        <div className="num">
          {num}
          {trend !== undefined && trend !== null && <span className={`trend ${trend >= 0 ? 'up' : 'down'}`}>{trend >= 0 ? '+' : '−'}{fmtPct(Math.abs(trend))}</span>}
        </div>
        <div className="lbl">{label}</div>
      </div>
    </div>
  );
}

export function Thumb({ post, brand, lg }: { post: Post; brand: { profile: { color: string } } | undefined; lg?: boolean }) {
  const img = post.media[0];
  if (img) return <img className={`thumb ${lg ? 'lg' : ''}`} src={img.url} alt={img.alt || ''} loading="lazy" />;
  return <span className={`thumb ${lg ? 'lg' : ''}`} style={{ background: brand?.profile.color ?? 'var(--draft-soft)', opacity: 0.35 }} aria-hidden />;
}

function countdown(ms: number) {
  if (ms <= 0) return 'teď';
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d >= 1) return `${d} d ${h} h`;
  return `${h} h ${m % 60} min`;
}

function UpNext({ post, brand, now }: { post: Post; brand: Brand | undefined; now: number }) {
  const nav = useNavigate();
  const img = post.media[0];
  const when = Date.parse(post.scheduledAt!);
  const label: Partial<Record<Post['status'], string>> = {
    in_review: 'Čeká na schválení', draft: 'Koncept', changes_requested: 'K úpravě', approved: 'Schváleno, nenaplánováno', scheduled: 'Naplánováno',
  };
  const tone = post.status === 'scheduled' ? 'st-scheduled' : post.status === 'in_review' ? 'st-in_review' : post.status === 'approved' ? 'st-approved' : 'st-changes_requested';
  return (
    <div className="upnext" role="link" tabIndex={0} onClick={() => nav(`/posty/${post.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/posty/${post.id}`)}>
      {img ? <img src={img.url} alt={img.alt || ''} /> : <div style={{ background: brand?.profile.color ?? '#333' }} />}
      <div className="body">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="brand">
            <span className="logo-dot" style={{ background: brand?.profile.color }}>{brand?.name.slice(0, 2).toUpperCase()}</span>
            {brand?.name}
          </span>
          <span className={`badge ${tone}`}>{label[post.status] ?? post.status}</span>
        </div>
        <span className="goes" style={{ marginTop: 8 }}>vyjde za</span>
        <span className="count">{countdown(when - now)}</span>
        <span className="when"><Clock size={13} /> {fmtDayShort(post.scheduledAt!)}, {fmtTime(post.scheduledAt!)}</span>
        <span className="text clamp2">{post.body}</span>
        <span className="go"><ArrowUpRight size={16} /></span>
      </div>
    </div>
  );
}

type NeedItem = { post: Post; kind: 'failed' | 'changes' | 'schedule' | 'waiting'; since?: string };

function NeedsList({ items, brandById }: { items: NeedItem[]; brandById: Map<string, Brand> }) {
  const api = useApi();
  const nav = useNavigate();
  const { run, busy } = useAction();
  const [all, setAll] = useState(false);
  if (!items.length) return <div className="empty small">Všechno je vyřízené.</div>;
  const shown = all ? items : items.slice(0, 4);
  return (
    <div className="needs">
      {shown.map(({ post: p, kind, since }) => (
        <div key={`${kind}-${p.id}`} className={`need ${kind === 'failed' ? 'bad' : ''}`}>
          {kind === 'failed' ? <span className="thumb"><AlertTriangle size={18} /></span> : <Thumb post={p} brand={brandById.get(p.brandId)} />}
          <div className="meta">
            <span className="small strong clamp2">{kind === 'failed' ? `Publikace „${p.title}“ selhala` : p.title}</span>
            <span className="small muted">
              {kind === 'failed' && 'Zkuste znovu, nebo zkontrolujte připojení účtu'}
              {kind === 'changes' && 'Klient chce úpravy'}
              {kind === 'schedule' && 'Schváleno, chybí naplánování'}
              {kind === 'waiting' && `Čeká na klienta · ${relative(since!)}`}
              {' · '}{brandById.get(p.brandId)?.name}
            </span>
            <div className="acts">
              {kind === 'failed' && <button className="btn primary sm" disabled={busy} onClick={() => void run(() => api.call('content.retryFailed', p.id), 'Publikace spuštěna znovu')}><RotateCcw size={13} /> Zkusit znovu</button>}
              {kind === 'schedule' && p.scheduledAt && Date.parse(p.scheduledAt) > Date.now() && (
                <button className="btn ok sm" disabled={busy} onClick={() => void run(() => api.call('content.schedule', p.id, p.scheduledAt!), 'Naplánováno')}><Check size={13} /> Naplánovat na {fmtDayShort(p.scheduledAt)}</button>
              )}
              {kind === 'changes' && <button className="btn primary sm" onClick={() => nav(`/posty/${p.id}`)}><Send size={13} /> Upravit</button>}
              <button className="btn sm" onClick={() => nav(`/posty/${p.id}`)}>Otevřít</button>
            </div>
          </div>
        </div>
      ))}
      {items.length > 4 && <button className="btn ghost sm" style={{ alignSelf: 'center' }} onClick={() => setAll(!all)}>{all ? 'Zobrazit méně' : `Zobrazit další ${items.length - 4}`}</button>}
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  'post.created': 'vytvořil(a) post',
  'post.edited': 'upravil(a) text postu',
  'post.updated': 'upravil(a) post',
  'post.submitted': 'poslal(a) post ke schválení',
  'post.approved': 'schválil(a) post',
  'post.changes_requested': 'vrátil(a) post k úpravě',
  'post.approved_internally': 'schválil(a) post interně',
  'post.scheduled': 'naplánoval(a) post',
  'post.unscheduled': 'zrušil(a) plán postu',
  'post.published': 'publikoval post',
  'post.publishing': 'začal publikovat post',
  'post.failed': 'nahlásil chybu publikace',
  'post.retry': 'spustil(a) publikaci znovu',
  'brand.created': 'přidal(a) značku',
  'brand.updated': 'upravil(a) profil značky',
  'client.created': 'přidal(a) klienta',
  'account.connected': 'připojil(a) účet',
  'account.disconnected': 'odpojil(a) účet',
  'member.invited': 'pozval(a) člena týmu',
  'member.removed': 'odebral(a) člena týmu',
  'ai.draft': 'nechal(a) navrhnout texty',
  'agency.created': 'založil(a) agenturu',
};
