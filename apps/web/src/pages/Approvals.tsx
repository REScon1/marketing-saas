import { useNavigate } from 'react-router-dom';
import { BrandTag, Empty, Loading, Networks, PageHead, StatusBadge } from '../components/ui';
import { isStaffRole, useApi, useData, useSession } from '../lib/app';
import { fmtDateTime, relative } from '../lib/format';
import { useCatalog } from '../lib/hooks';

export function Approvals() {
  const api = useApi();
  const { actor } = useSession();
  const staff = isStaffRole(actor.role);
  const nav = useNavigate();
  const { brandById } = useCatalog();
  const pending = useData(() => api.call('content.pendingApprovals'), []);
  const others = useData(
    () => api.call('content.listPosts', { status: staff ? ['changes_requested', 'approved'] : ['approved', 'scheduled', 'changes_requested'] }),
    [staff],
  );

  if (!pending.data || !others.data) return <Loading />;

  return (
    <>
      <PageHead
        title={staff ? 'Schvalování' : 'Ke schválení'}
        sub={staff ? 'Co čeká na klienty a co je potřeba dotáhnout' : 'Posty, které pro vás agentura připravila'}
      />
      <section className="card" style={{ marginBottom: 20 }}>
        <div className="card-head"><h2>{staff ? 'Čeká na klienta' : 'Čeká na vaše rozhodnutí'}</h2><span className="badge st-in_review">{pending.data.length}</span></div>
        {pending.data.length ? (
          <table className="table">
            <thead><tr><th>Post</th><th>Odesláno</th><th>Termín</th><th>Sítě</th></tr></thead>
            <tbody>
              {pending.data.map(({ post, approval }) => (
                <tr key={approval.id} className="click" onClick={() => nav(`/posty/${post.id}`)}>
                  <td><div className="strong">{post.title}</div><div className="small muted"><BrandTag brand={brandById.get(post.brandId)} /></div></td>
                  <td className="small">{relative(approval.requestedAt)}{staff && Date.now() - Date.parse(approval.requestedAt) > 2 * 864e5 && <span className="badge st-changes_requested" style={{ marginLeft: 6 }}>déle než 2 dny</span>}</td>
                  <td className="small">{fmtDateTime(post.scheduledAt)}</td>
                  <td><Networks networks={post.networks} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty title={staff ? 'Nic nečeká na klienty' : 'Hotovo, nic nečeká na vaše schválení'} />
        )}
      </section>

      <section className="card">
        <div className="card-head"><h2>{staff ? 'Vrácené k úpravě a schválené k naplánování' : 'Už vyřízené'}</h2></div>
        {others.data.length ? (
          <table className="table">
            <thead><tr><th>Post</th><th>Stav</th><th>Termín</th></tr></thead>
            <tbody>
              {others.data.map((p) => (
                <tr key={p.id} className="click" onClick={() => nav(`/posty/${p.id}`)}>
                  <td><div className="strong">{p.title}</div><div className="small muted"><BrandTag brand={brandById.get(p.brandId)} /></div></td>
                  <td><StatusBadge status={p.status} /></td>
                  <td className="small">{fmtDateTime(p.scheduledAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty title="Nic tu není" />
        )}
      </section>
    </>
  );
}
