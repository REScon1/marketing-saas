import { NETWORKS, type Concept, type Network, type PostFormat } from '@ms/core';
import { CalendarRange, Images, LayoutTemplate, RefreshCw, Sparkles, Smartphone, Square, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Field, NetworkIcon } from '../components/ui';
import { useAction, useApi, useBrandFilter, useData, useToast } from '../lib/app';
import { errorMessage, fmtDayShort, fmtTime, NETWORK_LABEL } from '../lib/format';
import { useCatalog } from '../lib/hooks';
import { useReveal } from '../lib/motion';
import { PreviewSwitcher } from '../studio/preview';

const FORMATS: { id: PostFormat; label: string; hint: string; icon: typeof Square }[] = [
  { id: 'image', label: 'Grafika', hint: '1 obrázek, 4:5', icon: Square },
  { id: 'carousel', label: 'Karusel', hint: '3–7 slidů', icon: Images },
  { id: 'reel', label: 'Reel', hint: 'video 9:16', icon: Smartphone },
  { id: 'story', label: 'Story', hint: 'video 9:16', icon: LayoutTemplate },
];

const BRIEF_IDEAS = [
  'Od pondělí pečeme bezlepkový chléb, jen na objednávku den předem',
  '5 chyb, které dělají začátečníci v posilovně',
  'Dokončili jsme halu v pasivním standardu: spotřeba 12 kWh/m² za rok',
  'Zákaznice nám napsala, že náš kváskový chléb jí připomíná babičku',
];

export function Studio() {
  const api = useApi();
  const nav = useNavigate();
  const toast = useToast();
  const { brands } = useCatalog();
  const { brandId: globalBrand } = useBrandFilter();
  const [brandId, setBrandId] = useState('');
  const [format, setFormat] = useState<PostFormat>('carousel');
  const [networks, setNetworks] = useState<Network[]>(['instagram', 'facebook']);
  const [brief, setBrief] = useState('');
  const [concepts, setConcepts] = useState<(Concept & { issues?: { message: string; severity: string }[] })[]>([]);
  const [busy, setBusy] = useState(false);
  const { run, busy: saving } = useAction();
  const info = useData(() => api.call('ai.info'), []);
  useReveal(brands.length > 0);

  useEffect(() => {
    if (globalBrand) setBrandId(globalBrand);
    else if (!brandId && brands[0]) setBrandId(brands[0].id);
  }, [brands, globalBrand, brandId]);
  const brand = brands.find((b) => b.id === brandId);

  async function generate() {
    if (!brief.trim()) return;
    setBusy(true);
    try {
      const out = await api.call('ai.concepts', { brandId, brief, format, networks, count: 3 });
      setConcepts(out);
      requestAnimationFrame(() => document.getElementById('concepts')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function use(c: Concept) {
    const post = await run(() => api.call('content.createFromConcept', { brandId, concept: c }), 'Koncept uložen, můžete ho doladit');
    if (post) nav(`/posty/${post.id}`);
  }

  return (
    <>
      <section className="studio-hero panel">
        <div className="studio-hero-copy">
          <span className="eyebrow"><Sparkles size={14} /> Studio</span>
          <h1>{'Co dnes\nvytvoříme?'}</h1>
          <p className="muted">Napište nápad jednou větou. Studio z něj udělá hotové koncepty ve značce klienta: vizuál, texty pro každou síť a hashtagy.</p>
        </div>
        <div className="studio-form">
          <div className="row" style={{ gap: 10 }}>
            <select id="studio-brand" className="select pill" value={brandId} onChange={(e) => setBrandId(e.target.value)} aria-label="Značka">
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <div className="row" style={{ gap: 6 }}>
              {NETWORKS.map((n) => {
                const on = networks.includes(n);
                return (
                  <button key={n} className={`chip ${on ? 'on' : ''}`} aria-pressed={on} title={NETWORK_LABEL[n]}
                    onClick={() => setNetworks(on ? networks.filter((x) => x !== n) : [...networks, n])}>
                    <NetworkIcon network={n} size={14} />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="format-picker" role="radiogroup" aria-label="Formát">
            {FORMATS.map((f) => (
              <button key={f.id} role="radio" aria-checked={format === f.id} className={`format ${format === f.id ? 'on' : ''}`} onClick={() => setFormat(f.id)}>
                <f.icon size={18} />
                <span className="strong">{f.label}</span>
                <span className="small muted">{f.hint}</span>
              </button>
            ))}
          </div>
          <textarea id="studio-brief" className="textarea brief" value={brief} onChange={(e) => setBrief(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void generate(); }}
            placeholder="O čem má obsah být? Např. „Od pondělí pečeme bezlepkový chléb, jen na objednávku den předem“" />
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row small muted" style={{ gap: 6 }}>
              Zkuste:
              {BRIEF_IDEAS.slice(0, 2).map((b) => <button key={b} className="link-btn" onClick={() => setBrief(b)}>{b.slice(0, 38)}…</button>)}
            </div>
            <button className="btn primary lg" disabled={busy || !brief.trim() || !networks.length || !brandId} onClick={() => void generate()}>
              <Wand2 size={17} /> {busy ? 'Tvořím…' : 'Vytvořit 3 koncepty'}
            </button>
          </div>
          <span className="small muted">{info.data?.isAi ? `Píše ${info.data.label}.` : 'Demo: texty skládá šablona, ne jazykový model. Po připojení AI klíče píše Claude.'}</span>
        </div>
      </section>

      {concepts.length > 0 && brand && (
        <section id="concepts" className="stack" style={{ marginTop: 28, gap: 16 }}>
          <div className="row">
            <h2 style={{ fontSize: 22 }}>Koncepty pro {brand.name}</h2>
            <button className="btn sm" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => void generate()}><RefreshCw size={14} /> Jiné varianty</button>
          </div>
          <div className="concepts">
            {concepts.map((c, i) => (
              <article key={i} className="concept panel">
                <div className="concept-head">
                  <span className="badge">{c.angle}</span>
                  <HookMeter score={c.hookScore} />
                </div>
                <div className="concept-preview">
                  <PreviewSwitcher brand={brand} design={c.design} captions={c.captions} networks={networks} playing />
                </div>
                <div className="concept-body">
                  <p className="strong">{c.hook}</p>
                  <p className="small muted">{c.why}</p>
                  {c.hashtags.length > 0 && <p className="small" style={{ color: 'var(--sched)' }}>{c.hashtags.join(' ')}</p>}
                  <div className="row" style={{ marginTop: 'auto' }}>
                    <button className="btn primary" disabled={saving} onClick={() => void use(c)}>Použít a upravit</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {brand && <Autopilot brandId={brand.id} brandName={brand.name} networks={networks} pillars={brand.profile.pillars} />}
    </>
  );
}

function HookMeter({ score }: { score: number }) {
  const tone = score >= 70 ? 'var(--pub)' : score >= 45 ? 'var(--wait)' : 'var(--bad)';
  return (
    <span className="hook" title="Síla háčku: heuristika (délka, otázka, číslo, oslovení, naléhavost). Neslibuje výsledek.">
      <span className="hook-bar"><span style={{ width: `${score}%`, background: tone }} /></span>
      <span className="small strong">{score}</span>
      <span className="small muted">háček</span>
    </span>
  );
}

/** Autopilot: z pilířů značky navrhne celý měsíc a jedním klikem vytvoří koncepty v kalendáři. */
function Autopilot({ brandId, brandName, networks, pillars }: { brandId: string; brandName: string; networks: Network[]; pillars: string[] }) {
  const api = useApi();
  const nav = useNavigate();
  const toast = useToast();
  const { run, busy } = useAction();
  const months = useMemo(() => {
    const d = new Date();
    return [0, 1].map((i) => {
      const x = new Date(d.getFullYear(), d.getMonth() + i, 1);
      return { v: `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`, label: x.toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' }) };
    });
  }, []);
  const [month, setMonth] = useState(months[0]!.v);
  const [perWeek, setPerWeek] = useState(3);
  const [plan, setPlan] = useState<{ date: string; pillar: string; idea: string; format: PostFormat }[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function propose() {
    setLoading(true);
    try {
      setPlan(await api.call('ai.planMonth', { brandId, month, postsPerWeek: perWeek, networks }));
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setLoading(false);
    }
  }

  const label: Record<PostFormat, string> = { image: 'Grafika', carousel: 'Karusel', reel: 'Reel', story: 'Story' };
  return (
    <section className="panel card-pad stack autopilot" style={{ marginTop: 28 }}>
      <div className="row">
        <div>
          <span className="eyebrow"><CalendarRange size={14} /> Autopilot</span>
          <h2 style={{ fontSize: 22, marginTop: 4 }}>Naplánovat celý měsíc pro {brandName}</h2>
          <p className="small muted">Střídá pilíře obsahu{pillars.length ? ` (${pillars.join(', ')})` : ''} a formáty. Vy jen projdete a schválíte.</p>
        </div>
        <div className="row" style={{ marginLeft: 'auto' }}>
          <select id="ap-month" className="select pill" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Měsíc">
            {months.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
          </select>
          <Field label="">
            <select id="ap-per-week" className="select pill" value={perWeek} onChange={(e) => setPerWeek(Number(e.target.value))} aria-label="Postů týdně">
              {[2, 3, 4, 5, 7].map((n) => <option key={n} value={n}>{n}× týdně</option>)}
            </select>
          </Field>
          <button className="btn" disabled={loading || !networks.length} onClick={() => void propose()}><Sparkles size={15} /> {loading ? 'Plánuji…' : 'Navrhnout plán'}</button>
        </div>
      </div>
      {plan && (
        <>
          <div className="plan">
            {plan.map((p, i) => (
              <div key={i} className="plan-item">
                <span className="mono small strong">{fmtDayShort(p.date)}</span>
                <span className="mono small muted">{fmtTime(p.date)}</span>
                <span className={`badge fmt-${p.format}`}>{label[p.format]}</span>
                <span className="small muted">{p.pillar}</span>
                <span className="strong small clamp1" style={{ flex: 1 }}>{p.idea}</span>
                <button className="btn ghost sm" onClick={() => setPlan(plan.filter((_, j) => j !== i))} aria-label="Vyřadit">Vyřadit</button>
              </div>
            ))}
          </div>
          <div className="row">
            <span className="small muted">{plan.length} postů. Každý dostane hotový návrh vizuálu a texty, všechny jako koncepty ke kontrole.</span>
            <button className="btn primary" style={{ marginLeft: 'auto' }} disabled={busy || !plan.length}
              onClick={async () => {
                const r = await run(() => api.call('content.bulkCreateFromPlan', { brandId, items: plan }), `Vytvořeno ${plan.length} konceptů v kalendáři`);
                if (r) nav('/kalendar');
              }}>
              Vytvořit {plan.length} konceptů
            </button>
          </div>
        </>
      )}
    </section>
  );
}
