import type { Backend, PublicApi } from '@ms/core';
import { Check, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { textForNetwork } from '@ms/core';
import { PreviewSwitcher } from '../studio/preview';
import { Avatar } from '../components/ui';
import { errorMessage, fmtDateTime, relative } from '../lib/format';

type View = Awaited<ReturnType<PublicApi['public.getApproval']>>;

/** Stránka pro klienta bez účtu: schválí nebo vrátí post přes odkaz z e-mailu. */
export function PublicApproval({ backend }: { backend: Backend }) {
  const { token = '' } = useParams();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem('ms-guest-name') ?? '';
    } catch {
      return '';
    }
  });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = () => backend.callPublic('public.getApproval', token).then(setView, (e) => setError(errorMessage(e)));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function decide(decision: 'approved' | 'changes_requested') {
    setBusy(true);
    setError(null);
    try {
      try {
        localStorage.setItem('ms-guest-name', name);
      } catch {
        /* ignore */
      }
      await backend.callPublic('public.decide', token, { name, decision, note });
      setDone(decision === 'approved' ? 'Děkujeme, post je schválený. Agentura ho naplánuje.' : 'Děkujeme, připomínky jsme předali agentuře.');
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && !view) return <div className="public-wrap"><div className="alert error">{error}</div></div>;
  if (!view) return <div className="public-wrap muted">Načítám…</div>;

  const open = view.approval.status === 'pending' && view.isCurrent;
  return (
    <div className="public-wrap stack" style={{ gap: 16 }}>
      {__DEMO__ && (
        <div className="alert warn small">
          Demo: takhle stránku uvidí klient po otevření odkazu, bez přihlášení.
          <a href="#/" style={{ marginLeft: 'auto', fontWeight: 700, textDecoration: 'underline' }} onClick={(e) => { e.preventDefault(); history.back(); }}>Zpět do aplikace</a>
        </div>
      )}
      <div className="row">
        <span className="brand-dot" style={{ background: view.brandColor, width: 14, height: 14 }} />
        <span className="strong">{view.brandName}</span>
        <span className="muted small">· připravila agentura {view.agencyName}</span>
      </div>
      <h1>{view.post.title}</h1>
      {done && <div className="alert ok">{done}</div>}
      {!open && !done && (
        <div className="alert info">
          {view.approval.status === 'approved' && `Schváleno ${fmtDateTime(view.approval.decidedAt)} (${view.approval.decidedByName}).`}
          {view.approval.status === 'changes_requested' && `Vráceno k úpravě ${fmtDateTime(view.approval.decidedAt)} (${view.approval.decidedByName}).`}
          {(view.approval.status === 'superseded' || !view.isCurrent) && 'Tento odkaz už neplatí: post se mezitím změnil nebo odkaz vypršel. Agentura vám pošle nový.'}
        </div>
      )}
      <section className="card card-pad">
        <p className="small muted" style={{ marginBottom: 10 }}>Plánovaná publikace: <strong>{fmtDateTime(view.post.scheduledAt)}</strong></p>
        <PreviewSwitcher brand={{ name: view.brandName, profile: view.brandProfile }} design={view.post.design} caption={view.post.body} captions={Object.fromEntries(view.post.networks.map((n) => [n, textForNetwork(view.post.body, view.post.overrides, n)]))} media={view.post.media} networks={view.post.networks} scheduledAt={view.post.scheduledAt} playing />
      </section>
      {view.comments.length > 0 && (
        <section className="card card-pad stack">
          <h2>Komentáře</h2>
          {view.comments.map((c, i) => (
            <div key={i} className={`comment ${c.authorRole === 'guest' || c.authorRole === 'client' ? 'client' : ''}`}>
              <Avatar name={c.authorName} />
              <div className="bubble"><div><span className="who">{c.authorName}</span><span className="when">{relative(c.createdAt)}</span></div><div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div></div>
            </div>
          ))}
        </section>
      )}
      {open && !done && (
        <section className="card card-pad stack">
          <h2>Vaše rozhodnutí</h2>
          {error && <div className="alert error">{error}</div>}
          <label className="field"><span>Vaše jméno</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
          <label className="field"><span>Poznámka (při vrácení povinná)</span><textarea className="textarea" style={{ minHeight: 80 }} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="row">
            <button className="btn ok" disabled={busy || !name.trim()} onClick={() => void decide('approved')}><Check size={15} /> Schválit</button>
            <button className="btn" disabled={busy || !name.trim() || !note.trim()} onClick={() => void decide('changes_requested')}><Undo2 size={15} /> Vrátit k úpravě</button>
          </div>
          <p className="small muted">Odkaz platí do {fmtDateTime(view.approval.expiresAt)}. Vaše rozhodnutí se uloží ke konkrétní verzi textu.</p>
        </section>
      )}
    </div>
  );
}
