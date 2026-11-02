import { NETWORKS, type Brand, type BrandProfile, type Client, type Network, type SocialAccount } from '@ms/core';
import { ArrowLeft, Plug, Plus } from 'lucide-react';
import { useState } from 'react';
import { useReveal } from '../lib/motion';
import { useNavigate, useParams } from 'react-router-dom';
import { ErrorBox, Field, Loading, Modal, NetworkIcon } from '../components/ui';
import { useAction, useApi, useData } from '../lib/app';
import { NETWORK_LABEL } from '../lib/format';

export function BrandPage() {
  const { id } = useParams();
  const api = useApi();
  const d = useData(() => api.call('catalog.getBrand', id!), [id]);
  useReveal(!!d.data);
  if (d.error) return <ErrorBox error={d.error} />;
  if (!d.data) return <Loading />;
  return <BrandForm key={d.data.brand.id + d.data.brand.name + JSON.stringify(d.data.brand.profile)} data={d.data} />;
}

function BrandForm({ data }: { data: { brand: Brand; client: Client; accounts: SocialAccount[] } }) {
  const api = useApi();
  const nav = useNavigate();
  const { run, busy } = useAction();
  const { brand, client, accounts } = data;
  const [name, setName] = useState(brand.name);
  const [p, setP] = useState<BrandProfile>(brand.profile);
  const [requires, setRequires] = useState(brand.requiresClientApproval);
  const [connect, setConnect] = useState<Network | null>(null);
  const set = <K extends keyof BrandProfile>(k: K, v: BrandProfile[K]) => setP((x) => ({ ...x, [k]: v }));
  const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  const dirty = name !== brand.name || requires !== brand.requiresClientApproval || JSON.stringify(p) !== JSON.stringify(brand.profile);

  return (
    <>
      <div className="page-head">
        <div>
          <button className="btn ghost sm" onClick={() => nav('/klienti')} style={{ marginLeft: -8, marginBottom: 6 }}><ArrowLeft size={14} /> Klienti</button>
          <h1 className="row"><span className="brand-dot" style={{ background: p.color, width: 14, height: 14 }} />{brand.name}</h1>
          <div className="sub">Klient {client.name}</div>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => nav(`/posty/novy?znacka=${brand.id}`)}><Plus size={15} /> Nový post</button>
          <button className="btn primary" disabled={!dirty || busy} onClick={() => void run(() => api.call('catalog.updateBrand', brand.id, { name, profile: p, requiresClientApproval: requires }), 'Profil značky uložen')}>Uložit profil</button>
        </div>
      </div>
      <div className="split">
        <section className="card card-pad stack">
          <h2>Brand profil</h2>
          <p className="small muted">Podle profilu píše AI asistent a kontroluje se každý post před odesláním klientovi.</p>
          <Field label="Název značky"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Tón hlasu" hint="Jak značka mluví. Tykání/vykání, délka vět, co nepoužívat.">
            <textarea className="textarea" style={{ minHeight: 70 }} value={p.tone} onChange={(e) => set('tone', e.target.value)} />
          </Field>
          <Field label="Cílové publikum"><textarea className="textarea" style={{ minHeight: 60 }} value={p.audience} onChange={(e) => set('audience', e.target.value)} /></Field>
          <div className="grid cols-2">
            <Field label="Zakázaná slova" hint="Jedno na řádek. Post s nimi nejde odeslat.">
              <textarea className="textarea" style={{ minHeight: 90 }} defaultValue={p.bannedWords.join('\n')} onBlur={(e) => set('bannedWords', lines(e.target.value))} />
            </Field>
            <Field label="Výchozí hashtagy" hint="Jeden na řádek.">
              <textarea className="textarea" style={{ minHeight: 90 }} defaultValue={p.defaultHashtags.join('\n')} onBlur={(e) => set('defaultHashtags', lines(e.target.value))} />
            </Field>
          </div>
          <div className="grid cols-3">
            <Field label="Max. hashtagů"><input className="input" type="number" min={0} max={30} value={p.maxHashtags} onChange={(e) => set('maxHashtags', Number(e.target.value))} /></Field>
            <Field label="Emoji">
              <select className="select" value={p.emoji} onChange={(e) => set('emoji', e.target.value as BrandProfile['emoji'])}>
                <option value="none">Nepoužívat</option><option value="few">Střídmě</option><option value="many">Klidně více</option>
              </select>
            </Field>
            <Field label="Barva"><input className="input" type="color" value={p.color} onChange={(e) => set('color', e.target.value)} style={{ height: 38, padding: 4 }} /></Field>
          </div>
          <Field label="Ukázkové posty" hint="Oddělte prázdným řádkem se třemi pomlčkami (---). AI se z nich učí styl.">
            <textarea className="textarea" style={{ minHeight: 120 }} defaultValue={p.examples.join('\n---\n')} onBlur={(e) => set('examples', e.target.value.split(/\n-{3,}\n/).map((x) => x.trim()).filter(Boolean))} />
          </Field>
          <label className="row" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={requires} onChange={(e) => setRequires(e.target.checked)} />
            <span><strong>Každý post musí schválit klient</strong><br /><span className="small muted">Bez zaškrtnutí schvaluje agentura sama.</span></span>
          </label>
        </section>

        <aside className="stack">
          <section className="card card-pad stack">
            <h2>Připojené účty</h2>
            <p className="small muted">V MVP přes službu pro publikaci na sítě (unified API). V demu je připojení simulované.</p>
            {NETWORKS.map((n) => {
              const a = accounts.find((x) => x.network === n);
              const on = a?.status === 'connected';
              return (
                <div key={n} className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="row"><NetworkIcon network={n} size={16} /><strong>{NETWORK_LABEL[n]}</strong>{a && <span className="small muted">{a.handle}</span>}</span>
                  {on ? (
                    <button className="btn sm danger" disabled={busy} onClick={() => void run(() => api.call('catalog.disconnectAccount', a!.id), 'Účet odpojen')}>Odpojit</button>
                  ) : (
                    <button className="btn sm" onClick={() => setConnect(n)}><Plug size={14} /> Připojit</button>
                  )}
                </div>
              );
            })}
          </section>
        </aside>
      </div>
      {connect && <ConnectModal brandId={brand.id} network={connect} onClose={() => setConnect(null)} />}
    </>
  );
}

function ConnectModal({ brandId, network, onClose }: { brandId: string; network: Network; onClose(): void }) {
  const api = useApi();
  const { run, busy } = useAction();
  const [handle, setHandle] = useState('@');
  return (
    <Modal title={`Připojit ${NETWORK_LABEL[network]}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Zrušit</button>
      <button className="btn primary" disabled={busy || handle.length < 2} onClick={async () => {
        if (await run(() => api.call('catalog.connectAccount', { brandId, network, handle }), 'Účet připojen')) onClose();
      }}>Připojit</button>
    </>}>
      <div className="alert info small">V ostrém provozu se tady otevře přihlášení do sítě přes poskytovatele publikace. Teď jen zadáte název účtu.</div>
      <Field label="Účet"><input className="input" value={handle} onChange={(e) => setHandle(e.target.value)} autoFocus /></Field>
    </Modal>
  );
}

