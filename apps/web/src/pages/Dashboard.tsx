import type { Post } from '@ms/core';
import { AlertTriangle, Clock, Plus, Send } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { BrandTag, Empty, Loading, Networks, PageHead, StatusBadge } from '../components/ui';
import { useApi, useData, useSession } from '../lib/app';
import { fmtDateTime, fmtDayShort, fmtTime, relative } from '../lib/format';
import { useCatalog } from '../lib/hooks';

export function Dashboard() {
  const api = useApi();
  const { actor } = useSession();
  const nav = useNavigate();
  const { brandById } = useCatalog();
  const posts = useData(() => api.call('content.listPosts'), []);
  const pending = useData(() => api.call('content.pendingApprovals'), []);
  const activity = useData(() => api.call('content.activity', { limit: 12 }), []);

  if (!posts.data) return <Loading />;
  const all = posts.data;
  const now = new Date().toISOString();
  const weekAhead = new Date(Date.now() + 7 * 864e5).toISOString();
  const attention = all.filter((p) => p.status === 'changes_requested' || p.status === 'failed');
  const upcoming = all.filter((p) => p.status === 'scheduled' && p.scheduledAt && p.scheduledAt >= now && p.scheduledAt < weekAhead);
  const toSchedule = all.filter((p) => p.status === 'approved');
  const drafts = all.filter((p) => p.status === 'draft');
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const publishedThisMonth = all.filter((p) => p.status === 'published' && p.publishedAt && p.publishedAt >= monthStart).length;

  const firstName = actor.name.split(' ')[0];

  return (
    <>
      <PageHead
        title={`Dobrý den, ${firstName}`}
        sub="Co dnes potřebuje vaši pozornost"
        actions={<button className="btn primary" onClick={() => nav('/posty/novy')}><Plus size={16} /> Nový post</button>}
      />

      <div className="grid cols-4" style={{ marginBottom: 20 }}>
        <Kpi label="Čeká na klienta" value={pending.data?.length ?? 0} to="/schvalovani" />
        <Kpi label="K naplánování" value={toSchedule.length} to="/schvalovani" />
        <Kpi label="Naplánováno na 7 dní" value={upcoming.length} to="/kalendar" />
        <Kpi label="Publikováno tento měsíc" value={publishedThisMonth} to="/reporty" />
      </div>

      <div className="split">
        <div className="stack">
          {attention.length > 0 && (
            <section className="card">
              <div className="card-head"><AlertTriangle size={16} color="var(--bad)" /><h2>Potřebuje pozornost</h2></div>
              <PostList posts={attention} brandById={brandById} note={(p) => (p.status === 'failed' ? 'Publikace selhala' : 'Klient chce úpravy')} />
            </section>
          )}
          <section className="card">
            <div className="card-head"><Clock size={16} /><h2>Nejbližších 7 dní</h2><Link to="/kalendar" className="right small muted">Kalendář →</Link></div>
            {upcoming.length ? (
              <table className="table">
                <tbody>
                  {upcoming.map((p) => (
                    <tr key={p.id} className="click" onClick={() => nav(`/posty/${p.id}`)}>
                      <td style={{ width: 120 }} className="mono small"><div className="strong">{fmtDayShort(p.scheduledAt!)}</div><div className="muted">{fmtTime(p.scheduledAt!)}</div></td>
                      <td><div className="strong">{p.title}</div><div className="small muted"><BrandTag brand={brandById.get(p.brandId)} /></div></td>
                      <td style={{ width: 90 }}><Networks networks={p.networks} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty title="Na příští týden není nic naplánováno" />
            )}
          </section>
          <section className="card">
            <div className="card-head"><Send size={16} /><h2>Schválené, čekají na naplánování</h2></div>
            {toSchedule.length ? <PostList posts={toSchedule} brandById={brandById} /> : <Empty title="Nic nečeká" />}
          </section>
          <section className="card">
            <div className="card-head"><h2>Rozpracované koncepty</h2></div>
            {drafts.length ? <PostList posts={drafts} brandById={brandById} /> : <Empty title="Žádné koncepty" />}
          </section>
        </div>

        <aside className="card">
          <div className="card-head"><h2>Poslední aktivita</h2></div>
          <div className="card-pad timeline">
            {(activity.data ?? []).map((e) => (
              <div key={e.id} className="ev">
                <span className="t">{relative(e.createdAt)}</span>
                <span><strong>{e.actorName}</strong> {ACTION_LABEL[e.action] ?? e.action}</span>
              </div>
            ))}
            {activity.data?.length === 0 && <span className="muted">Zatím nic</span>}
          </div>
        </aside>
      </div>
    </>
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

function Kpi({ label, value, to }: { label: string; value: number; to: string }) {
  return (
    <Link to={to} className="card kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </Link>
  );
}

function PostList({ posts, brandById, note }: { posts: Post[]; brandById: Map<string, { name: string; profile: { color: string } }>; note?: (p: Post) => string }) {
  const nav = useNavigate();
  return (
    <table className="table">
      <tbody>
        {posts.map((p) => (
          <tr key={p.id} className="click" onClick={() => nav(`/posty/${p.id}`)}>
            <td>
              <div className="strong">{p.title}</div>
              <div className="small muted row">
                <BrandTag brand={brandById.get(p.brandId)} />
                {note && <span>· {note(p)}</span>}
              </div>
            </td>
            <td style={{ width: 150 }} className="small muted">{p.scheduledAt ? fmtDateTime(p.scheduledAt) : 'bez termínu'}</td>
            <td style={{ width: 150 }}><StatusBadge status={p.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
