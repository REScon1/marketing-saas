import type { Role } from '@ms/core';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Avatar, Field, Loading, Modal, PageHead } from '../components/ui';
import { useAction, useApi, useData, useSession } from '../lib/app';
import { fmtDate, ROLE_LABEL } from '../lib/format';
import { useCatalog } from '../lib/hooks';

export function Team() {
  const api = useApi();
  const { actor } = useSession();
  const { clientById } = useCatalog();
  const members = useData(() => api.call('tenancy.listMembers'), []);
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  if (!members.data) return <Loading />;
  return (
    <>
      <PageHead title="Tým a přístupy" sub="Kdo má do agentury přístup a co smí" actions={<button className="btn primary" onClick={() => setOpen(true)}><Plus size={16} /> Pozvat</button>} />
      <section className="card">
        <table className="table">
          <thead><tr><th>Člověk</th><th>Role</th><th>Přístup</th><th>Od</th><th /></tr></thead>
          <tbody>
            {members.data.map((m) => (
              <tr key={m.id}>
                <td><span className="row"><Avatar name={m.user.name} /><span><div className="strong">{m.user.name}</div><div className="small muted">{m.user.email}</div></span></span></td>
                <td>{ROLE_LABEL[m.role]}</td>
                <td className="small">{m.role === 'client' ? `jen ${clientById.get(m.clientId ?? '')?.name ?? 'klient'}` : 'všichni klienti'}</td>
                <td className="small muted">{fmtDate(m.createdAt)}</td>
                <td style={{ textAlign: 'right' }}>
                  {m.userId !== actor.userId && (confirmId === m.id ? (
                    <span className="row" style={{ justifyContent: 'flex-end' }}>
                      <span className="small muted">Přístup skončí okamžitě.</span>
                      <button className="btn sm danger" disabled={busy} onClick={() => void run(() => api.call('tenancy.removeMember', m.id), 'Přístup odebrán')}>Odebrat</button>
                      <button className="btn sm" onClick={() => setConfirmId(null)}>Zrušit</button>
                    </span>
                  ) : (
                    <button className="btn sm danger" onClick={() => setConfirmId(m.id)}>Odebrat</button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {open && <Invite onClose={() => setOpen(false)} />}
    </>
  );
}

function Invite({ onClose }: { onClose(): void }) {
  const api = useApi();
  const { clients } = useCatalog();
  const { run, busy } = useAction();
  const [form, setForm] = useState<{ name: string; email: string; role: Role; clientId: string }>({ name: '', email: '', role: 'manager', clientId: '' });
  return (
    <Modal title="Pozvat do agentury" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Zrušit</button>
      <button className="btn primary" disabled={busy} onClick={async () => {
        if (await run(() => api.call('tenancy.inviteMember', { ...form, clientId: form.role === 'client' ? form.clientId : null }), 'Pozvánka vytvořena')) onClose();
      }}>Pozvat</button>
    </>}>
      <Field label="Jméno"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
      <Field label="E-mail"><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
      <Field label="Role">
        <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
          <option value="manager">Manažer: připravuje a plánuje obsah</option>
          <option value="owner">Majitel: navíc spravuje tým</option>
          <option value="client">Klient: schvaluje a vidí reporty svého klienta</option>
        </select>
      </Field>
      {form.role === 'client' && (
        <Field label="Klient">
          <select className="select" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
            <option value="">Vyberte…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      )}
      <p className="small muted">Odesílání pozvánek e-mailem zatím není hotové; člověk se přihlásí přes e-mail, který tu zadáte.</p>
    </Modal>
  );
}
