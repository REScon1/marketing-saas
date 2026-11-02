import type { MonthlyReport } from '@ms/core';
import { Printer, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { BrandTag, Empty, ErrorBox, Loading, NetworkIcon, PageHead } from '../components/ui';
import { useApi, useData, useSession } from '../lib/app';
import { fmtDate, fmtNum, fmtPct, NETWORK_LABEL } from '../lib/format';
import { useCatalog } from '../lib/hooks';

function monthOptions(n = 6) {
  const d = new Date();
  return Array.from({ length: n }, (_, i) => {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const v = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
    return { v, label: x.toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' }) };
  });
}

export function Reports() {
  const api = useApi();
  const { agencyName } = useSession();
  const { brands } = useCatalog();
  const months = useMemo(() => monthOptions(), []);
  const [brandId, setBrandId] = useState('');
  const [month, setMonth] = useState(months[1]!.v);
  useEffect(() => {
    if (!brandId && brands[0]) setBrandId(brands[0].id);
  }, [brands, brandId]);
  const report = useData(() => (brandId ? api.call('reports.monthly', brandId, month) : Promise.resolve(null)), [brandId, month]);

  return (
    <>
      <PageHead
        title="Měsíční report"
        sub="Pro klienta: výsledky publikovaných postů za měsíc"
        actions={
          <>
            <select className="select no-print" style={{ width: 200 }} value={brandId} onChange={(e) => setBrandId(e.target.value)} aria-label="Značka">
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select className="select no-print" style={{ width: 180 }} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Měsíc">
              {months.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
            </select>
            <button className="btn no-print" onClick={() => window.print()}><Printer size={15} /> Tisk / PDF</button>
          </>
        }
      />
      {report.error && <ErrorBox error={report.error} />}
      {!report.data ? <Loading /> : <ReportView r={report.data} agencyName={agencyName} />}
    </>
  );
}

function Delta({ cur, prev }: { cur: number; prev: number | undefined }) {
  if (prev === undefined || prev === 0) return <span className="small muted">bez srovnání</span>;
  const d = (cur - prev) / prev;
  return <span className={`delta ${d >= 0 ? 'up' : 'down'}`}>{d >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(d))} oproti min. měsíci</span>;
}

function ReportView({ r, agencyName }: { r: MonthlyReport; agencyName: string }) {
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="print-only">
        <h1>{r.brand.name}: report za {r.periodLabel}</h1>
        <p className="muted">Připravila agentura {agencyName}</p>
      </div>
      <section className="card card-pad stack" style={{ gap: 8 }}>
        <div className="row"><BrandTag brand={r.brand} /><span className="muted small">· {r.client.name} · {r.periodLabel}</span></div>
        <p style={{ fontSize: 15, lineHeight: 1.6 }}>{r.summary}</p>
        <span className="small muted row"><Sparkles size={12} /> {r.summaryByAi ? 'Shrnutí napsala AI z čísel níže, před odesláním ho zkontrolujte.' : 'Shrnutí je složené automaticky ze šablony.'}</span>
      </section>

      {r.totals.posts === 0 ? (
        <section className="card"><Empty title="V tomto měsíci nebyl publikován žádný post" /></section>
      ) : (
        <>
          <div className="grid cols-4">
            <div className="card kpi"><div className="label">Publikované posty</div><div className="value">{r.totals.posts}</div><Delta cur={r.totals.posts} prev={r.previous?.posts} /></div>
            <div className="card kpi"><div className="label">Dosah</div><div className="value">{fmtNum(r.totals.reach)}</div><Delta cur={r.totals.reach} prev={r.previous?.reach} /></div>
            <div className="card kpi"><div className="label">Interakce</div><div className="value">{fmtNum(r.totals.engagements)}</div><Delta cur={r.totals.engagements} prev={r.previous?.engagements} /></div>
            <div className="card kpi"><div className="label">Míra zapojení</div><div className="value">{fmtPct(r.totals.engagementRate)}</div><span className="small muted">interakce / dosah</span></div>
          </div>

          <section className="card card-pad">
            <h2 style={{ marginBottom: 4 }}>Dosah podle dne publikace</h2>
            <p className="small muted" style={{ marginBottom: 12 }}>Součet dosahu postů vydaných daný den.</p>
            <DailyBars data={r.daily} />
          </section>

          <div className="grid cols-2">
            <section className="card">
              <div className="card-head"><h2>Podle sítě</h2></div>
              <table className="table">
                <thead><tr><th>Síť</th><th style={{ textAlign: 'right' }}>Posty</th><th style={{ textAlign: 'right' }}>Dosah</th><th style={{ textAlign: 'right' }}>Zapojení</th></tr></thead>
                <tbody>
                  {r.byNetwork.map((n) => (
                    <tr key={n.network}>
                      <td><span className="row"><NetworkIcon network={n.network} /> {NETWORK_LABEL[n.network]}</span></td>
                      <td className="mono" style={{ textAlign: 'right' }}>{n.posts}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{fmtNum(n.reach)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{fmtPct(n.engagementRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="card">
              <div className="card-head"><h2>Nejlepší posty</h2></div>
              <table className="table">
                <thead><tr><th>Post</th><th style={{ textAlign: 'right' }}>Dosah</th><th style={{ textAlign: 'right' }}>Interakce</th></tr></thead>
                <tbody>
                  {r.topPosts.map((t) => (
                    <tr key={t.post.id}>
                      <td><div className="strong">{t.post.title}</div><div className="small muted">{fmtDate(t.post.publishedAt)}</div></td>
                      <td className="mono" style={{ textAlign: 'right' }}>{fmtNum(t.reach)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{fmtNum(t.engagements)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </>
      )}
      <p className="small muted">Metriky se stahují ze sítí jednou za hodinu. V demu jsou simulované.</p>
    </div>
  );
}

function DailyBars({ data }: { data: { date: string; reach: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760, H = 200, L = 44, B = 24, T = 8;
  const max = Math.max(1, ...data.map((d) => d.reach));
  const step = 10 ** Math.floor(Math.log10(max));
  const top = Math.ceil(max / step) * step;
  const ticks = [0, top / 2, top];
  const bw = (W - L - 8) / data.length;
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const h = hover !== null ? data[hover] : null;
  return (
    <div style={{ position: 'relative' }}>
      <svg className="bar-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Denní dosah publikovaných postů" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - 4} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{fmtNum(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = L + 4 + i * bw;
          const bh = (H - T - B) * (d.reach / top);
          const w = Math.max(2, bw - 2);
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)}>
              <rect x={x} y={T} width={bw} height={H - T - B} fill="transparent" />
              {d.reach > 0 && (
                <path
                  d={`M${x},${y(0)} V${y(d.reach) + Math.min(4, bh)} q0,-${Math.min(4, bh)} ${Math.min(4, w / 2)},-${Math.min(4, bh)} H${x + w - Math.min(4, w / 2)} q${Math.min(4, w / 2)},0 ${Math.min(4, w / 2)},${Math.min(4, bh)} V${y(0)} Z`}
                  fill="var(--accent)"
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
              {(i === 0 || (i + 1) % 5 === 0) && <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">{Number(d.date.slice(8))}.</text>}
            </g>
          );
        })}
        <line x1={L} x2={W - 4} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" strokeWidth="1" />
      </svg>
      {h && (
        <div className="card small" style={{ position: 'absolute', top: 0, left: `${Math.min(80, ((L + hover! * bw) / W) * 100)}%`, padding: '6px 10px', pointerEvents: 'none' }}>
          <div className="strong">{fmtDate(`${h.date}T12:00:00Z`)}</div>
          <div>Dosah: <span className="mono strong">{fmtNum(h.reach)}</span></div>
        </div>
      )}
    </div>
  );
}
