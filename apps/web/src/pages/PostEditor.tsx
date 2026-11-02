import {
  brandCheck, NETWORKS, NETWORK_LIMITS, textForNetwork,
  type BrandIssue, type Network, type PostDetail,
} from '@ms/core';
import {
  AlertCircle, ArrowLeft, Check, Copy, ExternalLink, History, Link2, RotateCcw, Send, Sparkles, Undo2, Wand2, Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PostPreview } from '../components/PostPreview';
import { Avatar, BrandTag, ErrorBox, Field, Loading, Modal, NetworkIcon, StatusBadge } from '../components/ui';
import { isStaffRole, useAction, useApi, useData, useSession, useToast } from '../lib/app';
import { fmtDateTime, fromLocalInput, NETWORK_LABEL, relative, ROLE_LABEL, toLocalInput } from '../lib/format';
import { useCatalog } from '../lib/hooks';

export function PostEditor() {
  const { id } = useParams();
  const api = useApi();
  const detail = useData(() => (id ? api.call('content.getPost', id) : Promise.resolve(null)), [id]);
  if (id && detail.error) return <ErrorBox error={detail.error} />;
  if (id && !detail.data) return <Loading />;
  return <Editor key={`${id ?? 'new'}:${detail.data?.post.updatedAt ?? ''}`} detail={detail.data ?? null} />;
}

interface Form {
  brandId: string;
  title: string;
  body: string;
  networks: Network[];
  overrides: Partial<Record<Network, string>>;
  scheduledAt: string;
  aiAssisted: boolean;
}

function Editor({ detail }: { detail: PostDetail | null }) {
  const api = useApi();
  const s = useSession();
  const staff = isStaffRole(s.actor.role);
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const { brands, brandById } = useCatalog();
  const { run, busy } = useAction();
  const post = detail?.post ?? null;

  const initial: Form = useMemo(() => {
    if (post) {
      return {
        brandId: post.brandId, title: post.title, body: post.body, networks: post.networks, overrides: post.overrides,
        scheduledAt: toLocalInput(post.scheduledAt), aiAssisted: post.aiAssisted,
      };
    }
    const day = params.get('den');
    return {
      brandId: params.get('znacka') ?? '', title: '', body: '', networks: [], overrides: {},
      scheduledAt: day ? `${day}T10:00` : '', aiAssisted: false,
    };
  }, [post, params]);

  const [f, setF] = useState<Form>(initial);
  const [overrideOn, setOverrideOn] = useState<Network | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [decision, setDecision] = useState<'approved' | 'changes_requested' | null>(null);

  useEffect(() => {
    if (!post && !f.brandId && brands[0]) setF((x) => ({ ...x, brandId: brands[0]!.id }));
  }, [brands, post, f.brandId]);

  const brand = detail?.brand ?? brandById.get(f.brandId);
  useEffect(() => {
    // Nový post: předvolit sítě, které má značka připojené
    if (!post && brand && f.networks.length === 0) setF((x) => ({ ...x, networks: ['facebook', 'instagram'] }));
  }, [brand, post, f.networks.length]);

  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const locked = !!post && ['publishing', 'published'].includes(post.status);
  const readOnly = !staff || locked;
  const issues: BrandIssue[] = brand ? brandCheck({ body: f.body, networks: f.networks, overrides: f.overrides }, brand.profile) : [];
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const resetsApproval = !!post && ['in_review', 'approved', 'scheduled', 'failed'].includes(post.status) && (f.body !== initial.body || JSON.stringify(f.networks) !== JSON.stringify(initial.networks) || JSON.stringify(f.overrides) !== JSON.stringify(initial.overrides));

  async function save(): Promise<string | undefined> {
    if (!f.brandId) {
      toast('Vyberte značku', 'error');
      return;
    }
    const payload = {
      title: f.title, body: f.body, networks: f.networks, overrides: f.overrides,
      scheduledAt: fromLocalInput(f.scheduledAt), aiAssisted: f.aiAssisted,
    };
    if (!post) {
      const created = await run(() => api.call('content.createPost', { brandId: f.brandId, ...payload }), 'Post uložen jako koncept');
      if (created) nav(`/posty/${created.id}`, { replace: true });
      return created?.id;
    }
    const updated = await run(() => api.call('content.updatePost', post.id, payload, post.updatedAt), resetsApproval ? 'Uloženo. Post se vrátil do konceptu a půjde znovu ke schválení.' : 'Uloženo');
    return updated?.id;
  }

  const approvalLink = detail?.approvals.find((a) => a.status === 'pending' && a.token);
  const linkUrl = approvalLink ? `${location.origin}${location.pathname}#/schvalit/${approvalLink.token}` : null;

  return (
    <>
      <div className="page-head">
        <div>
          <button className="btn ghost sm" onClick={() => nav(-1)} style={{ marginLeft: -8, marginBottom: 6 }}><ArrowLeft size={14} /> Zpět</button>
          <h1>{post ? post.title : 'Nový post'}</h1>
          <div className="sub row">
            {post && <StatusBadge status={post.status} />}
            {brand && <BrandTag brand={brand} />}
            {post && <span className="small">verze {post.version}</span>}
            {post?.aiAssisted && <span className="badge"><Sparkles size={11} /> s pomocí AI</span>}
          </div>
        </div>
        {staff && !locked && (
          <div className="actions">
            <button className="btn" onClick={() => void save()} disabled={busy || (!!post && !dirty)}>Uložit</button>
            <WorkflowActions detail={detail} dirty={dirty} issues={issues} onSubmit={() => setSubmitOpen(true)} />
          </div>
        )}
      </div>

      {post?.status === 'changes_requested' && staff && (
        <div className="alert warn" style={{ marginBottom: 16 }}>
          <AlertCircle size={16} />
          <div><strong>Klient chce úpravy:</strong> {detail?.approvals.at(-1)?.note ?? 'viz komentáře'}. Upravte text a pošlete znovu ke schválení.</div>
        </div>
      )}
      {post?.status === 'failed' && (
        <div className="alert error" style={{ marginBottom: 16 }}>
          <AlertCircle size={16} />
          <div><strong>Publikace selhala.</strong> {detail?.jobs.filter((j) => j.lastError).map((j) => `${NETWORK_LABEL[j.network]}: ${j.lastError}`).join(' · ')}</div>
        </div>
      )}

      <div className="split">
        <div className="stack">
          {!staff && post && <ClientDecisionCard detail={detail!} onDecide={setDecision} />}

          <section className="card card-pad stack">
            {!post && (
              <Field label="Značka">
                <select className="select" value={f.brandId} onChange={(e) => set('brandId', e.target.value)}>
                  {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Interní název" hint="Uvidí ho jen tým a klient, na síť se neposílá.">
              <input className="input" value={f.title} readOnly={readOnly} onChange={(e) => set('title', e.target.value)} placeholder="např. Vánoční cukroví na objednávku" />
            </Field>
            <Field label="Text postu">
              <textarea className="textarea" rows={9} value={f.body} readOnly={readOnly} onChange={(e) => set('body', e.target.value)} placeholder="Napište text, nebo si nechte navrhnout varianty od AI vpravo." />
            </Field>
            <div className="field">
              <span>Sítě</span>
              <div className="row">
                {NETWORKS.map((n) => {
                  const on = f.networks.includes(n);
                  const acc = detail?.accounts.find((a) => a.network === n && a.status === 'connected');
                  return (
                    <button key={n} type="button" className={`chip ${on ? 'on' : ''}`} disabled={readOnly} aria-pressed={on}
                      onClick={() => set('networks', on ? f.networks.filter((x) => x !== n) : [...f.networks, n])}>
                      <NetworkIcon network={n} size={13} /> {NETWORK_LABEL[n]}
                      {staff && detail && !acc && <span className="small muted">(nepřipojeno)</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            {staff && f.networks.length > 1 && !readOnly && (
              <div className="stack" style={{ gap: 8 }}>
                <div className="row small">
                  <span className="muted">Jiný text pro síť:</span>
                  {f.networks.map((n) => (
                    <button key={n} className={`chip ${overrideOn === n || f.overrides[n] ? 'on' : ''}`} onClick={() => setOverrideOn(overrideOn === n ? null : n)}>
                      {NETWORK_LABEL[n]}
                    </button>
                  ))}
                </div>
                {overrideOn && (
                  <Field label={`Text jen pro ${NETWORK_LABEL[overrideOn]}`} hint="Prázdné = použije se hlavní text.">
                    <textarea className="textarea" rows={5} value={f.overrides[overrideOn] ?? ''} onChange={(e) => set('overrides', { ...f.overrides, [overrideOn]: e.target.value })} />
                  </Field>
                )}
              </div>
            )}
            <Field label="Termín publikace" hint="Pražský čas.">
              <input className="input" type="datetime-local" style={{ maxWidth: 260 }} value={f.scheduledAt} readOnly={readOnly} onChange={(e) => set('scheduledAt', e.target.value)} />
            </Field>
            {staff && <IssuesList issues={issues} networks={f.networks} body={f.body} overrides={f.overrides} />}
            {resetsApproval && <div className="alert warn small">Změna textu nebo sítí zruší dosavadní schválení. Post se vrátí do konceptu.</div>}
          </section>

          {staff && !readOnly && brand && <AiPanel brandId={brand.id} networks={f.networks} body={f.body} onUse={(body) => setF((x) => ({ ...x, body, aiAssisted: true }))} />}
        </div>

        <aside className="stack">
          <section className="card card-pad">
            <h2 style={{ marginBottom: 12 }}>Náhled</h2>
            {brand && <PostPreview brandName={brand.name} brandColor={brand.profile.color} title={f.title || 'Váš vizuál'} body={f.body} overrides={f.overrides} networks={f.networks} scheduledAt={fromLocalInput(f.scheduledAt)} />}
          </section>

          {staff && linkUrl && (
            <section className="card card-pad stack">
              <h2 className="row"><Link2 size={16} /> Odkaz pro klienta</h2>
              <p className="small muted">Klient může schválit i bez účtu. Odkaz platí do {fmtDateTime(approvalLink!.expiresAt)} a jen pro tuto verzi.</p>
              <div className="row">
                <button className="btn sm" onClick={() => { void navigator.clipboard?.writeText(linkUrl); toast('Odkaz zkopírován'); }}><Copy size={14} /> Kopírovat</button>
                <a className="btn sm" href={linkUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Otevřít jako klient</a>
              </div>
            </section>
          )}

          {staff && detail && detail.jobs.length > 0 && <JobsCard detail={detail} />}

          {detail && <Comments detail={detail} />}
          {detail && <Versions detail={detail} onRestore={(body) => setF((x) => ({ ...x, body }))} canRestore={!readOnly} />}
        </aside>
      </div>

      {submitOpen && detail && <SubmitModal detail={detail} dirty={dirty} save={save} onClose={() => setSubmitOpen(false)} />}
      {decision && detail && <DecisionModal detail={detail} decision={decision} onClose={() => setDecision(null)} />}
    </>
  );
}

function WorkflowActions({ detail, dirty, issues, onSubmit }: { detail: PostDetail | null; dirty: boolean; issues: BrandIssue[]; onSubmit(): void }) {
  const api = useApi();
  const s = useSession();
  const { run, busy } = useAction();
  const toast = useToast();
  if (!detail) return null;
  const p = detail.post;
  const blocking = issues.some((i) => i.severity === 'error');
  switch (p.status) {
    case 'draft':
    case 'changes_requested':
      return (
        <button className="btn primary" onClick={onSubmit} disabled={busy || blocking} title={blocking ? 'Nejdřív opravte chyby v kontrole značky' : undefined}>
          <Send size={15} /> {detail.brand.requiresClientApproval ? 'Poslat ke schválení' : 'Schválit interně'}
        </button>
      );
    case 'approved':
      return (
        <button className="btn primary" disabled={busy || dirty} title={dirty ? 'Nejdřív uložte změny' : undefined}
          onClick={() => void run(() => api.call('content.schedule', p.id, p.scheduledAt ?? undefined), 'Post naplánován')}>
          <Check size={15} /> Naplánovat{p.scheduledAt ? ` na ${fmtDateTime(p.scheduledAt)}` : ''}
        </button>
      );
    case 'scheduled':
      return (
        <>
          <button className="btn" disabled={busy} onClick={() => void run(() => api.call('content.unschedule', p.id), 'Plán zrušen')}><Undo2 size={15} /> Zrušit plán</button>
          {s.demo && (
            <button className="btn primary" disabled={busy} title="Jen v demu: simuluje, že nastal čas publikace"
              onClick={() => void run(async () => {
                await s.demo!.publishNow(p.id);
                const d = await api.call('content.getPost', p.id);
                toast(d.post.status === 'published' ? 'Publikováno (simulace)' : `Stav: ${d.post.status}`);
              })}>
              <Zap size={15} /> Simulovat publikaci teď
            </button>
          )}
        </>
      );
    case 'failed':
      return <button className="btn primary" disabled={busy} onClick={() => void run(() => api.call('content.retryFailed', p.id), 'Publikace spuštěna znovu')}><RotateCcw size={15} /> Zkusit znovu</button>;
    default:
      return null;
  }
}

function IssuesList({ issues, networks, body, overrides }: { issues: BrandIssue[]; networks: Network[]; body: string; overrides: Partial<Record<Network, string>> }) {
  return (
    <div className="stack" style={{ gap: 6, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
      <div className="row small">
        <strong>Kontrola značky</strong>
        {networks.map((n) => {
          const len = [...textForNetwork(body, overrides, n)].length;
          const max = NETWORK_LIMITS[n].maxChars;
          return <span key={n} className={`small ${len > max ? 'strong' : 'muted'}`} style={len > max ? { color: 'var(--bad)' } : {}}>{NETWORK_LABEL[n]} {len.toLocaleString('cs-CZ')}/{max.toLocaleString('cs-CZ')}</span>;
        })}
      </div>
      {issues.length === 0 ? (
        <div className="issue small" style={{ color: 'var(--ok)' }}><Check size={14} /> V pořádku podle profilu značky</div>
      ) : (
        issues.map((i, k) => (
          <div key={k} className={`issue ${i.severity}`}><AlertCircle size={14} style={{ flex: 'none', marginTop: 2 }} /> {i.message}</div>
        ))
      )}
    </div>
  );
}

function AiPanel({ brandId, networks, body, onUse }: { brandId: string; networks: Network[]; body: string; onUse(body: string): void }) {
  const api = useApi();
  const toast = useToast();
  const info = useData(() => api.call('ai.info'), []);
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const [variants, setVariants] = useState<Awaited<ReturnType<typeof api.call<'ai.draft'>>>>([]);

  async function draft() {
    setBusy(true);
    try {
      setVariants(await api.call('ai.draft', { brandId, brief, networks }));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'AI nedostupná', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function rewrite(instruction: string) {
    setBusy(true);
    try {
      const r = await api.call('ai.rewrite', { brandId, body, instruction });
      onUse(r.body);
      toast('Text upraven, zkontrolujte ho prosím');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'AI nedostupná', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card card-pad stack">
      <div className="row">
        <h2 className="row"><Wand2 size={16} /> AI asistent</h2>
        <span className="small muted" style={{ marginLeft: 'auto' }}>{info.data?.label}</span>
      </div>
      <p className="small muted">Píše podle profilu značky (tón, zakázaná slova, hashtagy). Vždy jde jen o návrh: text před odesláním zkontrolujte.</p>
      <Field label="Brief">
        <textarea className="textarea" style={{ minHeight: 70 }} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="O čem má post být? Např. „od pondělí pečeme bezlepkový chléb, jen na objednávku den předem“" />
      </Field>
      <div className="row">
        <button className="btn primary" disabled={busy || !brief.trim()} onClick={() => void draft()}><Sparkles size={15} /> Navrhnout 3 varianty</button>
        {body.trim() && (
          <>
            <span className="small muted">Upravit stávající text:</span>
            <button className="btn sm" disabled={busy} onClick={() => void rewrite('zkrátit na polovinu')}>Zkrátit</button>
            <button className="btn sm" disabled={busy} onClick={() => void rewrite('formálněji, vykat')}>Formálněji</button>
          </>
        )}
      </div>
      {variants.length > 0 && (
        <div className="grid" style={{ gap: 10 }}>
          {variants.map((v, i) => (
            <div key={i} className="ai-variant">
              <div className="angle">{v.angle}</div>
              <div className="text">{v.body}</div>
              {v.issues.length > 0 && <div className="small" style={{ color: 'var(--warn)' }}>{v.issues.map((x) => x.message).join(' · ')}</div>}
              <div><button className="btn sm" onClick={() => { onUse(v.body); toast('Varianta vložena do textu'); }}>Použít tuto variantu</button></div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SubmitModal({ detail, dirty, save, onClose }: { detail: PostDetail; dirty: boolean; save(): Promise<string | undefined>; onClose(): void }) {
  const api = useApi();
  const { run, busy } = useAction();
  const [note, setNote] = useState('');
  const needsClient = detail.brand.requiresClientApproval;
  return (
    <Modal
      title={needsClient ? 'Poslat ke schválení klientovi' : 'Schválit interně'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Zrušit</button>
          <button className="btn primary" disabled={busy} onClick={async () => {
            if (dirty && !(await save())) return;
            const r = await run(() => api.call('content.submitForApproval', detail.post.id, { note }), needsClient ? 'Odesláno klientovi ke schválení' : 'Schváleno');
            if (r) onClose();
          }}>
            <Send size={15} /> {needsClient ? 'Odeslat' : 'Schválit'}
          </button>
        </>
      }
    >
      {needsClient ? (
        <p>Klient {detail.client.name} uvidí post ve svém portálu a dostane odkaz, přes který ho může schválit i bez přihlášení.</p>
      ) : (
        <p>Značka {detail.brand.name} nemá povinné schválení klientem. Post bude rovnou připravený k naplánování.</p>
      )}
      {dirty && <div className="alert info small">Neuložené změny se nejdřív uloží.</div>}
      <Field label="Vzkaz pro klienta (nepovinné)">
        <textarea className="textarea" style={{ minHeight: 80 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="např. Fotku dodáme do čtvrtka." />
      </Field>
    </Modal>
  );
}

function ClientDecisionCard({ detail, onDecide }: { detail: PostDetail; onDecide(d: 'approved' | 'changes_requested'): void }) {
  const p = detail.post;
  if (p.status !== 'in_review') {
    const last = detail.approvals.filter((a) => a.status !== 'pending').at(-1);
    return (
      <div className="alert info">
        <Check size={16} />
        <div>{last ? `${last.status === 'approved' ? 'Schváleno' : 'Vráceno k úpravě'} ${fmtDateTime(last.decidedAt)} (${last.decidedByName}).` : 'Post zatím nečeká na vaše rozhodnutí.'}</div>
      </div>
    );
  }
  return (
    <section className="card card-pad stack" style={{ borderColor: 'var(--warn)' }}>
      <h2>Agentura čeká na vaše rozhodnutí</h2>
      <p className="muted">Zkontrolujte text a náhled. Termín publikace: <strong>{fmtDateTime(p.scheduledAt)}</strong>.</p>
      <div className="row">
        <button className="btn ok" onClick={() => onDecide('approved')}><Check size={15} /> Schválit</button>
        <button className="btn" onClick={() => onDecide('changes_requested')}><Undo2 size={15} /> Vrátit k úpravě</button>
      </div>
    </section>
  );
}

function DecisionModal({ detail, decision, onClose }: { detail: PostDetail; decision: 'approved' | 'changes_requested'; onClose(): void }) {
  const api = useApi();
  const { run, busy } = useAction();
  const [note, setNote] = useState('');
  const approve = decision === 'approved';
  return (
    <Modal
      title={approve ? 'Schválit post' : 'Vrátit k úpravě'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Zrušit</button>
          <button className={`btn ${approve ? 'ok' : 'primary'}`} disabled={busy || (!approve && !note.trim())} onClick={async () => {
            const r = await run(() => api.call('content.decide', detail.post.id, decision, note), approve ? 'Děkujeme, post je schválený' : 'Odesláno agentuře');
            if (r) onClose();
          }}>
            {approve ? 'Schválit' : 'Odeslat připomínky'}
          </button>
        </>
      }
    >
      <Field label={approve ? 'Poznámka (nepovinné)' : 'Co upravit?'}>
        <textarea className="textarea" style={{ minHeight: 90 }} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}

function JobsCard({ detail }: { detail: PostDetail }) {
  const label = { pending: 'čeká', running: 'probíhá', succeeded: 'publikováno', failed: 'chyba', unknown: 'ověřuje se výsledek', cancelled: 'zrušeno' } as const;
  const jobs = detail.jobs.filter((j) => j.postVersion === detail.post.version);
  if (!jobs.length) return null;
  return (
    <section className="card card-pad stack">
      <h2>Publikace</h2>
      {jobs.map((j) => (
        <div key={j.id} className="row small">
          <NetworkIcon network={j.network} />
          <strong>{NETWORK_LABEL[j.network]}</strong>
          <span className="muted">{label[j.status]}{j.attempts > 1 ? ` · pokus ${j.attempts}` : ''}</span>
          {j.externalUrl && <a className="small" style={{ marginLeft: 'auto', color: 'var(--accent)' }} href={j.externalUrl} target="_blank" rel="noreferrer">odkaz</a>}
        </div>
      ))}
    </section>
  );
}

function Comments({ detail }: { detail: PostDetail }) {
  const api = useApi();
  const { run, busy } = useAction();
  const [text, setText] = useState('');
  return (
    <section className="card card-pad stack">
      <h2>Komentáře</h2>
      {detail.comments.length === 0 && <p className="small muted">Zatím bez komentářů.</p>}
      {detail.comments.map((c) => (
        <div key={c.id} className={`comment ${c.authorRole === 'client' || c.authorRole === 'guest' ? 'client' : ''}`}>
          <Avatar name={c.authorName} />
          <div className="bubble">
            <div><span className="who">{c.authorName}</span><span className="when">{c.authorRole === 'guest' ? 'klient přes odkaz' : ROLE_LABEL[c.authorRole]} · {relative(c.createdAt)} · v{c.postVersion}</span></div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
          </div>
        </div>
      ))}
      <form className="stack" style={{ gap: 8 }} onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => api.call('content.addComment', detail.post.id, text))) setText('');
      }}>
        <textarea className="textarea" style={{ minHeight: 60 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Napsat komentář…" aria-label="Nový komentář" />
        <div><button className="btn sm" disabled={busy || !text.trim()}>Přidat komentář</button></div>
      </form>
    </section>
  );
}

function Versions({ detail, onRestore, canRestore }: { detail: PostDetail; onRestore(body: string): void; canRestore: boolean }) {
  const [open, setOpen] = useState(false);
  if (detail.post.versions.length < 2) return null;
  return (
    <section className="card card-pad stack">
      <button className="row btn ghost" style={{ justifyContent: 'flex-start', padding: 0 }} onClick={() => setOpen(!open)} aria-expanded={open}>
        <History size={16} /> <h2>Historie verzí ({detail.post.versions.length})</h2>
      </button>
      {open && [...detail.post.versions].reverse().map((v) => (
        <div key={v.n} className="stack" style={{ gap: 4, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          <div className="row small"><strong>Verze {v.n}</strong><span className="muted">{fmtDateTime(v.createdAt)}</span>
            {canRestore && v.n !== detail.post.version && <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => onRestore(v.body)}>Vrátit text</button>}
          </div>
          <div className="small" style={{ whiteSpace: 'pre-wrap', color: 'var(--ink-2)' }}>{v.body || <em className="muted">prázdné</em>}</div>
        </div>
      ))}
    </section>
  );
}
