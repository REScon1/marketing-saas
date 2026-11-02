import { useReveal } from '../lib/motion';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, Field, Loading, Modal, PageHead } from '../components/ui';
import { useAction, useApi, useData } from '../lib/app';

export function Clients() {
  const api = useApi();
  const nav = useNavigate();
  const clients = useData(() => api.call('catalog.listClients'), []);
  const brands = useData(() => api.call('catalog.listBrands'), []);
  const posts = useData(() => api.call('content.listPosts'), []);
  const [modal, setModal] = useState<null | { kind: 'client' } | { kind: 'brand'; clientId: string }>(null);

  useReveal(!!(clients.data && brands.data));
  if (!clients.data || !brands.data) return <Loading />;

  return (
    <>
      <PageHead
        title={'Klienti\na značky'}
        sub={`${clients.data.length} klientů · ${brands.data.length} značek`}
        actions={<button className="btn primary" onClick={() => setModal({ kind: 'client' })}><Plus size={16} /> Nový klient</button>}
      />
      <div className="stack" style={{ gap: 22 }}>
        {clients.data.map((c) => {
          const bs = brands.data!.filter((b) => b.clientId === c.id);
          return (
            <section key={c.id} className="panel card-pad">
              <div className="row" style={{ marginBottom: 14 }}>
                <span className="avatar">{c.name.slice(0, 2).toUpperCase()}</span>
                <div>
                  <h2>{c.name}</h2>
                  {c.contactEmail && <span className="small muted">{c.contactEmail}</span>}
                </div>
                <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setModal({ kind: 'brand', clientId: c.id })}><Plus size={14} /> Značka</button>
              </div>
              {bs.length ? (
                <div className="brand-grid">
                  {bs.map((b) => {
                    const ps = (posts.data ?? []).filter((p) => p.brandId === b.id);
                    const cover = ps.filter((p) => p.media[0]).sort((x, y) => (y.publishedAt ?? y.updatedAt).localeCompare(x.publishedAt ?? x.updatedAt))[0]?.media[0]?.url;
                    const count = (st: string[]) => ps.filter((p) => st.includes(p.status)).length;
                    return (
                      <button key={b.id} className="brand-card" onClick={() => nav(`/znacky/${b.id}`)} style={{ ['--tint' as string]: b.profile.color }}>
                        <span className="cover">{cover ? <img src={cover} alt="" /> : <span style={{ background: b.profile.color }} />}</span>
                        <span className="body">
                          <span className="row"><span className="brand-dot" style={{ background: b.profile.color }} /><strong>{b.name}</strong>
                            <span className="badge" style={{ marginLeft: 'auto' }}>{b.requiresClientApproval ? 'schvaluje klient' : 'schvaluje agentura'}</span></span>
                          <span className="small muted clamp2">{b.profile.tone || 'Tón hlasu zatím není vyplněný.'}</span>
                          <span className="nums">
                            <span><b>{count(['scheduled'])}</b> naplánováno</span>
                            <span><b>{count(['in_review'])}</b> ke schválení</span>
                            <span><b>{count(['published'])}</b> publikováno</span>
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <Empty title="Zatím žádná značka" />
              )}
            </section>
          );
        })}
      </div>
      {modal?.kind === 'client' && <NewClient onClose={() => setModal(null)} />}
      {modal?.kind === 'brand' && <NewBrand clientId={modal.clientId} onClose={(id) => { setModal(null); if (id) nav(`/znacky/${id}`); }} />}
    </>
  );
}

function NewClient({ onClose }: { onClose(): void }) {
  const api = useApi();
  const { run, busy } = useAction();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  return (
    <Modal title="Nový klient" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Zrušit</button>
      <button className="btn primary" disabled={busy || !name.trim()} onClick={async () => {
        if (await run(() => api.call('catalog.createClient', { name, contactEmail: email || null }), 'Klient přidán')) onClose();
      }}>Přidat</button>
    </>}>
      <Field label="Název"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <Field label="Kontaktní e-mail (nepovinné)"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
    </Modal>
  );
}

function NewBrand({ clientId, onClose }: { clientId: string; onClose(id?: string): void }) {
  const api = useApi();
  const { run, busy } = useAction();
  const [name, setName] = useState('');
  return (
    <Modal title="Nová značka" onClose={() => onClose()} footer={<>
      <button className="btn" onClick={() => onClose()}>Zrušit</button>
      <button className="btn primary" disabled={busy || !name.trim()} onClick={async () => {
        const b = await run(() => api.call('catalog.createBrand', { clientId, name }), 'Značka přidána');
        if (b) onClose(b.id);
      }}>Přidat a nastavit profil</button>
    </>}>
      <Field label="Název značky"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
    </Modal>
  );
}
