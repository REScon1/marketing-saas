import type { Brand, DesignSlide, DesignSpec, MediaRef, PostFormat } from '@ms/core';
import { ArrowDown, ArrowUp, Download, Film, ImagePlus, Plus, Shuffle, Trash2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Field } from '../components/ui';
import { useToast } from '../lib/app';
import { errorMessage } from '../lib/format';
import { exportPng, exportVideo, TEMPLATES } from './render';
import { DesignThumb } from './preview';

const FORMAT_LABEL: Record<PostFormat, string> = { image: 'Grafika', carousel: 'Karusel', reel: 'Reel', story: 'Story' };
const LIMITS: Record<PostFormat, [number, number]> = { image: [1, 1], carousel: [2, 10], reel: [1, 8], story: [1, 8] };

export function emptyDesign(format: PostFormat, title: string): DesignSpec {
  const video = format === 'reel' || format === 'story';
  const slides: DesignSlide[] =
    format === 'carousel'
      ? [{ kicker: 'NOVINKA', headline: title }, { headline: 'Co je nového', body: 'Doplňte hlavní sdělení.' }, { headline: 'Přijďte se podívat' }]
      : video
        ? [{ headline: title }, { headline: 'Doplňte druhou scénu' }]
        : [{ kicker: 'NOVINKA', headline: title }];
  return { format, templateId: format === 'carousel' ? 'list' : video ? 'gradient' : 'editorial', aspect: video ? '9:16' : '4:5', slides, cta: 'Více v profilu', durationSec: video ? 9 : undefined, seed: Math.floor(Math.random() * 1e6) };
}

function convert(d: DesignSpec, format: PostFormat): DesignSpec {
  const video = format === 'reel' || format === 'story';
  const [min, max] = LIMITS[format];
  let slides = d.slides.slice(0, max);
  while (slides.length < min) slides = [...slides, { headline: 'Další slide' }];
  const tpl = TEMPLATES.find((t) => t.id === d.templateId);
  return {
    ...d, format, slides,
    aspect: video ? '9:16' : d.aspect === '9:16' ? '4:5' : d.aspect,
    durationSec: video ? d.durationSec ?? Math.max(6, slides.length * 3) : undefined,
    templateId: tpl && tpl.formats.includes(format) ? d.templateId : (TEMPLATES.find((t) => t.formats.includes(format))?.id ?? d.templateId),
  };
}

export function DesignEditor({ design, readOnly, brand, media, onChange, title }: {
  design: DesignSpec | null; readOnly: boolean; brand: Brand; media: MediaRef[]; onChange(d: DesignSpec | null): void; title: string;
}) {
  const toast = useToast();
  const [active, setActive] = useState(0);
  const [exporting, setExporting] = useState<string | null>(null);

  if (!design) {
    if (readOnly) return null;
    return (
      <section className="panel card-pad stack">
        <h2 className="row"><Wand2 size={16} /> Vizuál</h2>
        <p className="small muted">Post zatím nemá navržený vizuál. Vyberte formát a začněte ze šablony ve značce {brand.name}.</p>
        <div className="row">
          {(['image', 'carousel', 'reel', 'story'] as PostFormat[]).map((f) => (
            <button key={f} className="btn" onClick={() => onChange(emptyDesign(f, title))}>{FORMAT_LABEL[f]}</button>
          ))}
        </div>
      </section>
    );
  }

  const d = design;
  const video = d.format === 'reel' || d.format === 'story';
  const [, max] = LIMITS[d.format];
  const cur = Math.min(active, d.slides.length - 1);
  const slide = d.slides[cur]!;
  const setSlide = (patch: Partial<DesignSlide>) => onChange({ ...d, slides: d.slides.map((s, i) => (i === cur ? { ...s, ...patch } : s)) });
  const move = (dir: -1 | 1) => {
    const j = cur + dir;
    if (j < 0 || j >= d.slides.length) return;
    const slides = [...d.slides];
    [slides[cur], slides[j]] = [slides[j]!, slides[cur]!];
    onChange({ ...d, slides });
    setActive(j);
  };
  const brandLook = { name: brand.name, profile: brand.profile };

  async function download(kind: 'png' | 'video') {
    setExporting(kind);
    try {
      let blob: Blob;
      let ext = 'png';
      if (kind === 'png') blob = await exportPng(d, brandLook, cur);
      else {
        const r = await exportVideo(d, brandLook, () => {});
        blob = r.blob;
        ext = r.mime.includes('mp4') ? 'mp4' : 'webm';
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${brand.name}-${kind === 'png' ? `slide-${cur + 1}` : d.format}.${ext}`.replace(/\s+/g, '-');
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setExporting(null);
    }
  }

  return (
    <section className="panel card-pad stack design-editor">
      <div className="row">
        <h2 className="row"><Wand2 size={16} /> Vizuál</h2>
        <div className="seg" style={{ marginLeft: 'auto' }} role="tablist" aria-label="Formát">
          {(['image', 'carousel', 'reel', 'story'] as PostFormat[]).map((f) => (
            <button key={f} role="tab" aria-selected={d.format === f} className={d.format === f ? 'on' : ''} disabled={readOnly} onClick={() => onChange(convert(d, f))}>{FORMAT_LABEL[f]}</button>
          ))}
        </div>
      </div>

      {!readOnly && (
        <div className="tpl-strip" role="radiogroup" aria-label="Šablona">
          {TEMPLATES.filter((t) => t.formats.includes(d.format)).map((t) => (
            <button key={t.id} role="radio" aria-checked={d.templateId === t.id} className={`tpl ${d.templateId === t.id ? 'on' : ''}`} onClick={() => onChange({ ...d, templateId: t.id })} title={t.description}>
              <DesignThumb design={{ ...d, templateId: t.id }} brand={brandLook} media={media} size={86} rounded={10} />
              <span className="small">{t.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="slides-row" role="tablist" aria-label={video ? 'Scény' : 'Slidy'}>
        {d.slides.map((s, i) => (
          <button key={i} role="tab" aria-selected={i === cur} className={`slide-tab ${i === cur ? 'on' : ''}`} onClick={() => setActive(i)}>
            <span className="mono small">{i + 1}</span>
            <span className="small clamp1">{s.headline || '—'}</span>
          </button>
        ))}
        {!readOnly && d.slides.length < max && (
          <button className="slide-tab add" onClick={() => { onChange({ ...d, slides: [...d.slides, { headline: 'Nový slide' }] }); setActive(d.slides.length); }} aria-label="Přidat slide">
            <Plus size={14} />
          </button>
        )}
      </div>

      <div className="grid cols-2" style={{ gap: 12 }}>
        <Field label="Nadtitulek"><input id="ds-kicker" className="input" value={slide.kicker ?? ''} readOnly={readOnly} maxLength={30} onChange={(e) => setSlide({ kicker: e.target.value })} placeholder="např. TIP #2" /></Field>
        <Field label={video ? 'Text ve scéně' : 'Titulek'}><input id="ds-headline" className="input" value={slide.headline} readOnly={readOnly} maxLength={90} onChange={(e) => setSlide({ headline: e.target.value })} /></Field>
      </div>
      <Field label="Doplňující text"><textarea id="ds-body" className="textarea" style={{ minHeight: 64 }} value={slide.body ?? ''} readOnly={readOnly} maxLength={220} onChange={(e) => setSlide({ body: e.target.value })} /></Field>

      {!readOnly && (
        <div className="field">
          <span>Fotka na {video ? 'scéně' : 'slidu'}</span>
          <div className="row">
            {media.filter((m) => m.kind === 'image').map((m) => (
              <button key={m.id} className={`media-pick ${slide.mediaUrl === m.url ? 'on' : ''}`} onClick={() => setSlide({ mediaUrl: slide.mediaUrl === m.url ? null : m.url })} aria-pressed={slide.mediaUrl === m.url}>
                <img src={m.url} alt={m.alt} />
              </button>
            ))}
            {media.length === 0 && <span className="small muted row"><ImagePlus size={14} /> Nahrajte fotky v sekci Obrázky výše, pak je tu přiřadíte ke slidu.</span>}
          </div>
        </div>
      )}

      <div className="row">
        <Field label="Výzva (poslední slide)"><input id="ds-cta" className="input" value={d.cta ?? ''} readOnly={readOnly} maxLength={40} onChange={(e) => onChange({ ...d, cta: e.target.value })} /></Field>
        {video && (
          <Field label={`Délka: ${d.durationSec ?? 9} s`}>
            <input id="ds-duration" type="range" min={6} max={60} step={1} value={d.durationSec ?? 9} disabled={readOnly} onChange={(e) => onChange({ ...d, durationSec: Number(e.target.value) })} />
          </Field>
        )}
        {!video && (
          <Field label="Poměr stran">
            <select id="ds-aspect" className="select" value={d.aspect} disabled={readOnly} onChange={(e) => onChange({ ...d, aspect: e.target.value as DesignSpec['aspect'] })}>
              <option value="4:5">4:5 (doporučeno pro feed)</option>
              <option value="1:1">1:1</option>
            </select>
          </Field>
        )}
      </div>

      <div className="row">
        {!readOnly && (
          <>
            <button className="btn sm" onClick={() => move(-1)} disabled={cur === 0} aria-label="Posunout dříve"><ArrowUp size={14} /></button>
            <button className="btn sm" onClick={() => move(1)} disabled={cur === d.slides.length - 1} aria-label="Posunout později"><ArrowDown size={14} /></button>
            <button className="btn sm danger" disabled={d.slides.length <= LIMITS[d.format][0]} onClick={() => { onChange({ ...d, slides: d.slides.filter((_, i) => i !== cur) }); setActive(Math.max(0, cur - 1)); }}><Trash2 size={14} /> Odebrat</button>
            <button className="btn sm" onClick={() => onChange({ ...d, seed: Math.floor(Math.random() * 1e6) })}><Shuffle size={14} /> Jiné pozadí</button>
          </>
        )}
        <span style={{ marginLeft: 'auto' }} className="row">
          {__DEMO__ && <span className="small muted">Stažení funguje v nasazené aplikaci.</span>}
          <button className="btn sm" disabled={!!exporting || __DEMO__} onClick={() => void download('png')}><Download size={14} /> {exporting === 'png' ? 'Exportuji…' : `PNG (slide ${cur + 1})`}</button>
          {video && <button className="btn sm" disabled={!!exporting || __DEMO__} onClick={() => void download('video')}><Film size={14} /> {exporting === 'video' ? `Renderuji ${d.durationSec ?? 9} s…` : 'Stáhnout video'}</button>}
        </span>
      </div>
    </section>
  );
}
