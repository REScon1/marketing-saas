import type { MonthlyReport } from '@ms/core';
import { Printer, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Empty, ErrorBox, Loading, NetworkIcon } from '../components/ui';
import { useApi, useBrandFilter, useData, useSession } from '../lib/app';
import { fmtDate, fmtNum, fmtPct, NETWORK_LABEL } from '../lib/format';
import { useCatalog } from '../lib/hooks';
import { Thumb } from './Dashboard';

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
  const { agencyName, demo } = useSession();
  const { brandId: globalBrand } = useBrandFilter();
  const { brands } = useCatalog();
  const months = useMemo(() => monthOptions(), []);
  const [brandId, setBrandId] = useState('');
  const [month, setMonth] = useState(months[1]!.v);
  useEffect(() => {
    if (globalBrand) setBrandId(globalBrand);
    else if (!brandId && brands[0]) setBrandId(brands[0].id);
  }, [brands, brandId, globalBrand]);
  const report = useData(() => (brandId ? api.call('reports.monthly', brandId, month) : Promise.resolve(null)), [brandId, month]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{'Měsíční\nreport'}</h1>
          <div className="sub">Výsledky publikovaných postů za měsíc, připravené pro klienta</div>
        </div>
        <div className="actions no-print">
          <select id="report-brand" className="select" style={{ width: 200, borderRadius: 999 }} value={brandId} onChange={(e) => setBrandId(e.target.value)} aria-label="Značka">
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select id="report-month" className="select" style={{ width: 180, borderRadius: 999 }} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Měsíc">
            {months.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
          </select>
          {!demo && <button className="btn" onClick={() => window.print()}><Printer size={15} /> Tisk / PDF</button>}
        </div>
      </div>
      {report.error && <ErrorBox error={report.error} />}
      {!report.data ? <Loading /> : <ReportView r={report.data} agencyName={agencyName} />}
    </>
  );
}

function pctDelta(cur: number, prev: number | undefined) {
  if (prev === undefined || prev === 0) return null;
  return (cur - prev) / prev;
}

function ReportView({ r, agencyName }: { r: MonthlyReport; agencyName: string }) {
  const cumulative = useMemo(() => {
    let acc = 0;
    return r.daily.map((d) => ({ date: d.date, v: (acc += d.reach) }));
  }, [r.daily]);
  const cumEng = useMemo(() => {
    let acc = 0;
    return r.daily.map((d) => (acc += d.engagements));
  }, [r.daily]);
  const best = [...r.byNetwork].sort((a, b) => b.engagements - a.engagements)[0];

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="print-only">
        <h1>{r.brand.name}: report za {r.periodLabel}</h1>
        <p className="muted">Připravila agentura {agencyName}</p>
      </div>

      <div className="report-hero">
        <section className="chart-panel">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="row small"><span className="brand-dot" style={{ background: r.brand.profile.color }} /> {r.brand.name} · {r.periodLabel}</span>
            <span className="small muted">kumulovaný dosah</span>
          </div>
          <div>
            <div className="big">{fmtNum(r.totals.reach)}</div>
            <div className="small muted" style={{ marginTop: 4 }}>
              lidí zasáhly posty v měsíci
              {pctDelta(r.totals.reach, r.previous?.reach) !== null && (
                <span className={`trend ${pctDelta(r.totals.reach, r.previous?.reach)! >= 0 ? 'up' : 'down'}`}>
                  {pctDelta(r.totals.reach, r.previous?.reach)! >= 0 ? '+' : '−'}{fmtPct(Math.abs(pctDelta(r.totals.reach, r.previous?.reach)!))} oproti min. měsíci
                </span>
              )}
            </div>
          </div>
          {r.totals.posts > 0 ? <AreaChart points={cumulative} days={r.daily} /> : <Empty title="V tomto měsíci nebyl publikován žádný post" />}
          <div className="pills">
            <div><div className="v">{r.totals.posts}</div><div className="l">publikovaných postů</div></div>
            <div><div className="v">{fmtNum(r.totals.impressions)}</div><div className="l">zobrazení</div></div>
            <div><div className="v">{fmtNum(r.totals.clicks)}</div><div className="l">prokliků</div></div>
            {best && <div><div className="v row" style={{ gap: 6 }}><NetworkIcon network={best.network} size={16} />{NETWORK_LABEL[best.network]}</div><div className="l">nejsilnější síť</div></div>}
          </div>
        </section>

        <section className="panel card-pad stack" style={{ gap: 10 }}>
          <h2>Shrnutí pro klienta</h2>
          <p style={{ fontSize: 14.5, lineHeight: 1.6 }}>{r.summary}</p>
          <span className="small muted row"><Sparkles size={12} /> {r.summaryByAi ? 'Napsala AI z čísel v reportu. Před odesláním zkontrolujte.' : 'Složeno automaticky ze šablony.'}</span>
          <div className="divider" style={{ height: 1, background: 'var(--line)', margin: '6px 0' }} />
          <h2>Nejlepší posty</h2>
          {r.topPosts.length === 0 && <span className="small muted">Žádné publikované posty.</span>}
          {r.topPosts.map((t) => (
            <div key={t.post.id} className="top-post">
              <Thumb post={t.post} brand={r.brand} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="small strong clamp1">{t.post.title}</div>
                <div className="small muted">{fmtDate(t.post.publishedAt)} · zapojení {fmtPct(t.engagementRate)}</div>
              </div>
              <div className="mono small strong" style={{ textAlign: 'right' }}>{fmtNum(t.reach)}<div className="muted" style={{ fontWeight: 400 }}>dosah</div></div>
            </div>
          ))}
        </section>
      </div>

      {r.totals.posts > 0 && (
        <div className="grid cols-4">
          <KpiCard label="Dosah" value={fmtNum(r.totals.reach)} delta={pctDelta(r.totals.reach, r.previous?.reach)} series={cumulative.map((c) => c.v)} />
          <KpiCard label="Interakce" value={fmtNum(r.totals.engagements)} delta={pctDelta(r.totals.engagements, r.previous?.engagements)} series={cumEng} />
          <KpiCard label="Míra zapojení" value={fmtPct(r.totals.engagementRate)} delta={pctDelta(r.totals.engagementRate, r.previous?.engagementRate)} note="interakce / dosah" />
          <KpiCard label="Publikované posty" value={String(r.totals.posts)} delta={pctDelta(r.totals.posts, r.previous?.posts)} note={r.previous ? `minule ${r.previous.posts}` : 'bez srovnání'} />
        </div>
      )}

      {r.byNetwork.length > 0 && (
        <section className="panel">
          <div className="card-head"><h2>Podle sítě</h2></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Síť</th><th style={{ textAlign: 'right' }}>Posty</th><th style={{ textAlign: 'right' }}>Dosah</th><th style={{ textAlign: 'right' }}>Interakce</th><th style={{ textAlign: 'right' }}>Zapojení</th></tr></thead>
              <tbody>
                {r.byNetwork.map((n) => (
                  <tr key={n.network}>
                    <td><span className="row"><NetworkIcon network={n.network} /> {NETWORK_LABEL[n.network]}</span></td>
                    <td className="mono" style={{ textAlign: 'right' }}>{n.posts}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmtNum(n.reach)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmtNum(n.engagements)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmtPct(n.engagementRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <p className="small muted">Metriky se stahují ze sítí jednou za hodinu. V demu jsou simulované.</p>
    </div>
  );
}

function KpiCard({ label, value, delta, series, note }: { label: string; value: string; delta: number | null; series?: number[]; note?: string }) {
  return (
    <div className="panel kpi-card">
      <div className="small muted">{label}</div>
      <div className="kpi" style={{ padding: 0 }}><div className="value">{value}</div></div>
      <div className="row small">
        {delta !== null ? <span className={`trend ${delta >= 0 ? 'up' : 'down'}`} style={{ margin: 0 }}>{delta >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(delta))}</span> : <span className="muted">{note ?? 'bez srovnání'}</span>}
        {delta !== null && note && <span className="muted">{note}</span>}
      </div>
      {series && <Spark values={series} />}
    </div>
  );
}

function Spark({ values }: { values: number[] }) {
  const W = 200, H = 34;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${((i / Math.max(1, values.length - 1)) * W).toFixed(1)},${(H - 2 - (v / max) * (H - 6)).toFixed(1)}`);
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <polyline points={pts.join(' ')} fill="none" stroke="var(--primary)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={W} cy={pts.at(-1)!.split(',')[1]} r="3" fill="var(--primary)" />
    </svg>
  );
}

/** Kumulovaný dosah v měsíci: plocha s přechodem, tečky ve dnech publikace, popisek při najetí. */
function AreaChart({ points, days }: { points: { date: string; v: number }[]; days: { date: string; reach: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760, H = 210, L = 8, R = 8, T = 14, B = 26;
  const max = Math.max(1, ...points.map((p) => p.v));
  const x = (i: number) => L + (i / Math.max(1, points.length - 1)) * (W - L - R);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const h = hover !== null ? points[hover] : null;
  return (
    <div style={{ position: 'relative' }}>
      <svg className="area-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Kumulovaný dosah během měsíce" onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f07b2f" stopOpacity=".55" />
            <stop offset="1" stopColor="#f07b2f" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.5, 1].map((f) => <line key={f} x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} stroke="rgba(255,255,255,.08)" />)}
        <path d={area} fill="url(#areaFill)" />
        <path d={line} fill="none" stroke="#f39a5c" strokeWidth="2.5" strokeLinejoin="round" />
        {days.map((d, i) => d.reach > 0 && <circle key={d.date} cx={x(i)} cy={y(points[i]!.v)} r="4.5" fill="#f39a5c" stroke="#221e1b" strokeWidth="2" />)}
        {points.map((p, i) => (
          <rect key={p.date} x={x(i) - (W / points.length) / 2} y={0} width={W / points.length} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={y(0)} stroke="rgba(255,255,255,.35)" strokeDasharray="3 3" />}
        {[0, Math.floor(points.length / 2), points.length - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 6} fontSize="11" fill="rgba(255,255,255,.55)" textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>{Number(points[i]!.date.slice(8))}.</text>
        ))}
      </svg>
      {h && (
        <div className="small" style={{ position: 'absolute', top: 0, left: `${Math.min(78, (x(hover!) / W) * 100)}%`, background: 'rgba(0,0,0,.6)', color: '#fff', padding: '6px 10px', borderRadius: 10, pointerEvents: 'none' }}>
          <div className="strong">{fmtDate(`${h.date}T12:00:00Z`)}</div>
          <div>Dosah celkem: <span className="mono strong">{fmtNum(h.v)}</span></div>
          {days[hover!]!.reach > 0 && <div>Ten den: +{fmtNum(days[hover!]!.reach)}</div>}
        </div>
      )}
    </div>
  );
}
