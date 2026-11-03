// Vývojářská galerie pro vizuální QA: všechny šablony × formáty × ukázkové značky + mockupy sítí.
import type { BrandProfile, DesignSlide, DesignSpec, PostStatus, TemplateId } from '@ms/core';
import { useMemo, useState } from 'react';
import { DesignCanvas, TEMPLATES, type BrandLook } from '../studio/render';
import { FacebookPost, FeedGrid, InstagramPost, LinkedInPost, PhoneReel, PreviewSwitcher, type FeedGridPost } from '../studio/preview';

const BASE_PROFILE: BrandProfile = {
  tone: 'přátelský, věcný',
  audience: '',
  bannedWords: [],
  examples: [],
  defaultHashtags: [],
  maxHashtags: 5,
  languages: ['cs'],
  emoji: 'none',
  color: '#111111',
  secondaryColor: '#000000',
  accentColor: '#cccccc',
  logoUrl: null,
  fontHeading: 'Onest',
  fontBody: 'Onest',
  pillars: [],
  website: null,
};

interface Sample {
  brand: BrandLook;
  base: DesignSlide[];
  offer: DesignSlide;
  quote: DesignSlide;
  list: DesignSlide;
  cta: string;
  reel: { templateId: TemplateId; slides: DesignSlide[]; cta: string; variant: 'reels' | 'tiktok' | 'story' };
  caption: string;
}

const SAMPLES: Sample[] = [
  {
    brand: {
      name: 'Pekárna Kvásek',
      profile: {
        ...BASE_PROFILE,
        audience: 'rodiny a milovníci poctivého pečiva v Brně',
        color: '#c2410c',
        secondaryColor: '#3a1d0f',
        accentColor: '#f5c26b',
        fontHeading: 'Fraunces',
        fontBody: 'Onest',
        pillars: ['Chleba', 'Za oponou', 'Sezóna', 'Recepty', 'Prodejny'],
        website: 'https://www.kvasek.cz',
      },
    },
    base: [
      { kicker: 'Sobotní pečení', headline: 'Kváskový chléb, který vydrží celý týden', body: 'Pečeme z žitného kvásku a mouky z mlýna v Kroměříži. Bez zlepšovadel, jen čas a ruce.' },
      { kicker: 'Tip č. 1', headline: 'Krájejte až těsně před jídlem', body: 'Kůrka chrání střídu před vysycháním. Chléb skladujte v plátěném sáčku, nikdy v lednici.' },
      { kicker: 'Tip č. 2', headline: 'Okoralý chléb oživíte v troubě', body: 'Pokropte kůrku vodou a dejte ho na 6 minut do 200 °C. Křupe jako ráno.' },
      { kicker: 'Tip č. 3', headline: 'Ze zbytků udělejte krutony', body: 'Kostičky s olivovým olejem a solí, 12 minut v troubě. Ideální do polévky.' },
      { kicker: 'Objednávky', headline: 'Upečeme vám bochník na sobotu', body: 'Objednávky do čtvrtka 18:00, vyzvednutí na Údolní 12.' },
    ],
    offer: { kicker: 'Jen tento víkend', headline: 'Druhý croissant za polovinu', body: 'Platí v sobotu a v neděli na všech prodejnách Kvásek v Brně.' },
    quote: { kicker: 'Markéta, zákaznice', headline: 'Nejlepší chleba v Brně. Chodíme si pro něj každou sobotu už třetí rok.' },
    list: { kicker: 'Jak na to', headline: '3 způsoby, jak udržet chléb čerstvý', body: 'Plátěný sáček místo igelitu; Krájet až před jídlem; Nikdy ho nedávat do lednice' },
    cta: 'Objednat chléb',
    reel: {
      templateId: 'photo',
      variant: 'reels',
      cta: 'Objednat na sobotu',
      slides: [
        { kicker: '4:30 ráno', headline: 'Než se Brno probudí, chleba už kyne', body: 'Každý bochník tvarujeme ručně.' },
        { kicker: '18 hodin', headline: 'Tolik času dáváme kvásku', body: 'Pomalé kynutí je tajemství chuti i kůrky.' },
        { kicker: 'Sobota', headline: 'Čerstvý bochník pro vás', body: 'Objednávky do čtvrtka večer.' },
      ],
    },
    caption:
      'Kváskový chléb, který vydrží celý týden. Pečeme ho z žitného kvásku a mouky z Kroměříže, bez zlepšovadel a bez spěchu.\n\nV karuselu najdete tři tipy, jak ho doma udržet čerstvý. Který znáte?\n\n#kvasek #brno #chleba #remeslo',
  },
  {
    brand: {
      name: 'FitZóna Ostrava',
      profile: {
        ...BASE_PROFILE,
        audience: 'začátečníci a mírně pokročilí 25–45 let',
        color: '#16a34a',
        secondaryColor: '#0b1f14',
        accentColor: '#d9f99d',
        fontHeading: 'Unbounded',
        fontBody: 'DM Sans',
        pillars: ['Trénink', 'Výživa', 'Komunita', 'Proměny'],
        website: 'https://fitzona-ostrava.cz',
      },
    },
    base: [
      { kicker: 'Nový program', headline: 'Silnější za 8 týdnů. Bez dřiny naslepo.', body: 'Skupinový silový trénink pro začátečníky. Maximálně 8 lidí na jednoho trenéra.' },
      { kicker: 'Krok 1', headline: 'Začněte dvakrát týdně', body: 'Pravidelnost porazí intenzitu. Dva tréninky po 45 minutách stačí na viditelný posun.' },
      { kicker: 'Krok 2', headline: 'Technika před vahou', body: 'První dva týdny ladíme pohyb. Váhu přidáváme, až když dřep sedí.' },
      { kicker: 'Krok 3', headline: 'Spánek je součást tréninku', body: 'Sedm hodin spánku udělá pro regeneraci víc než jakýkoli doplněk.' },
      { kicker: 'Přidejte se', headline: 'První trénink je na nás', body: 'Úvodní konzultace a měření zdarma, stačí si vybrat termín.' },
    ],
    offer: { kicker: 'Jen do neděle', headline: 'První měsíc za 490 Kč', body: 'Neomezený vstup, konzultace s trenérem a tréninkový plán na míru zdarma.' },
    quote: { kicker: 'Lenka, členka od března', headline: 'Za tři měsíce jsem shodila devět kilo a hlavně mě to konečně baví.' },
    list: { kicker: 'Checklist', headline: 'Co si vzít na první trénink', body: 'Pohodlné boty s pevnou podrážkou; Láhev s vodou; Ručník a zámek na skříňku' },
    cta: 'Rezervovat lekci',
    reel: {
      templateId: 'bold',
      variant: 'tiktok',
      cta: 'Rezervovat lekci',
      slides: [
        { kicker: 'Pondělí 6:30', headline: 'Nejtěžší je přijít', body: 'Zbytek zvládneme spolu, krok za krokem.' },
        { kicker: 'Krok 1', headline: 'Rozcvička 10 minut', body: 'Mobilita kyčlí a ramen, žádné zbytečné protahování.' },
        { kicker: 'Krok 2', headline: 'Silový blok', body: 'Dřep, mrtvý tah, tlaky. Technika před vahou.' },
        { kicker: 'Zkuste to', headline: 'První trénink je na nás', body: 'Stačí si vybrat termín v rezervačním systému.' },
      ],
    },
    caption: 'Silnější za 8 týdnů, bez dřiny naslepo. Nový program pro začátečníky startuje 1. prosince, kapacita je 8 lidí na trenéra. Rezervace v odkazu v profilu. #fitzona #ostrava #silovytrenink',
  },
  {
    brand: {
      name: 'Stavby Horák',
      profile: {
        ...BASE_PROFILE,
        audience: 'rodiny plánující stavbu domu ve Středočeském kraji',
        color: '#1d4ed8',
        secondaryColor: '#0f172a',
        accentColor: '#fbbf24',
        fontHeading: 'Archivo',
        fontBody: 'Manrope',
        pillars: ['Realizace', 'Rady', 'Tým', 'Technologie'],
        website: 'https://www.stavbyhorak.cz',
      },
    },
    base: [
      { kicker: 'Realizace 2026', headline: 'Rodinný dům v Říčanech předán o 3 týdny dřív', body: 'Dřevostavba 142 m² v nízkoenergetickém standardu, kompletně na klíč za 7 měsíců.' },
      { kicker: 'Rada č. 1', headline: 'Pevná cena patří do smlouvy', body: 'Rozpočet s rezervou 10 % chrání vás i nás. Vícepráce řešíme písemně předem.' },
      { kicker: 'Rada č. 2', headline: 'Reference si jeďte prohlédnout', body: 'Fotky snese papír. Rádi vás vezmeme na dům, který jsme předali loni.' },
      { kicker: 'Rada č. 3', headline: 'Jeden stavbyvedoucí od A do Z', body: 'Máte jedno telefonní číslo a jednoho člověka, který za stavbu ručí.' },
      { kicker: 'Konzultace', headline: 'Probereme váš projekt zdarma', body: 'Hodinová schůzka nad projektem, rozpočtem a harmonogramem.' },
    ],
    offer: { kicker: 'Volné kapacity', headline: 'Stavbu začneme už v březnu', body: 'Zbývají dva termíny pro domy do 180 m² ve Středočeském kraji.' },
    quote: { kicker: 'Rodina Malých, Říčany', headline: 'Termíny seděly na den a stavbyvedoucí nám každý pátek poslal fotky ze stavby.' },
    list: { kicker: 'Než podepíšete', headline: 'Na co si dát pozor u stavební firmy', body: 'Pevná cena ve smlouvě; Reference, které můžete navštívit; Jeden stavbyvedoucí od začátku do konce' },
    cta: 'Domluvit konzultaci',
    reel: {
      templateId: 'editorial',
      variant: 'story',
      cta: 'Domluvit konzultaci',
      slides: [
        { kicker: 'Týden 1', headline: 'Základová deska hotová', body: 'Betonáž proběhla za suchého počasí, přesně podle plánu.' },
        { kicker: 'Týden 6', headline: 'Hrubá stavba stojí', body: 'Dřevostavba roste rychle, ale kontrolujeme každý spoj.' },
        { kicker: 'Týden 28', headline: 'Klíče předány', body: 'O tři týdny dřív, než říkala smlouva.' },
      ],
    },
    caption:
      'Rodinný dům v Říčanech jsme předali o tři týdny dřív, než říkala smlouva. Dřevostavba 142 m², nízkoenergetický standard, na klíč za 7 měsíců.\n\nDěkujeme rodině Malých za důvěru a za kávu na každém kontrolním dni.',
  },
];

/** Vygeneruje „fotku“ (krajina se světlem, oparem a zrnem), aby se otestovala cesta s fotkou bez internetu. */
function makePhoto(seed: number, warm: string, cool: string): string {
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 1500;
  const x = c.getContext('2d')!;
  const sky = x.createLinearGradient(0, 0, 0, 1500);
  sky.addColorStop(0, cool);
  sky.addColorStop(0.55, warm);
  sky.addColorStop(1, '#1b1410');
  x.fillStyle = sky;
  x.fillRect(0, 0, 1200, 1500);
  const sun = x.createRadialGradient(780, 620, 10, 780, 620, 520);
  sun.addColorStop(0, 'rgba(255,240,210,.95)');
  sun.addColorStop(0.2, 'rgba(255,210,150,.55)');
  sun.addColorStop(1, 'rgba(255,200,140,0)');
  x.fillStyle = sun;
  x.fillRect(0, 0, 1200, 1500);
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const layers = ['rgba(60,40,40,.55)', 'rgba(40,28,28,.75)', 'rgba(22,16,16,.92)'];
  layers.forEach((col, li) => {
    x.fillStyle = col;
    x.beginPath();
    const base = 820 + li * 170;
    x.moveTo(0, 1500);
    for (let px = 0; px <= 1200; px += 40) x.lineTo(px, base - Math.sin(px / (180 + li * 60) + li + seed) * (70 - li * 15) - r() * 25);
    x.lineTo(1200, 1500);
    x.fill();
  });
  for (let i = 0; i < 26; i++) {
    const bx = r() * 1200;
    const by = 200 + r() * 900;
    const br = 10 + r() * 50;
    const g = x.createRadialGradient(bx, by, 0, bx, by, br);
    g.addColorStop(0, 'rgba(255,230,190,.35)');
    g.addColorStop(1, 'rgba(255,230,190,0)');
    x.fillStyle = g;
    x.fillRect(bx - br, by - br, br * 2, br * 2);
  }
  const img = x.getImageData(0, 0, 1200, 1500);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 22;
    img.data[i] = img.data[i]! + n;
    img.data[i + 1] = img.data[i + 1]! + n;
    img.data[i + 2] = img.data[i + 2]! + n;
  }
  x.putImageData(img, 0, 0);
  return c.toDataURL('image/jpeg', 0.86);
}

function slidesFor(t: TemplateId, s: Sample): DesignSlide[] {
  if (t === 'quote') return [s.quote];
  if (t === 'list') return [s.list];
  if (t === 'bold') return [s.offer];
  return [s.base[0]!];
}

function Card({ design, brand, label }: { design: DesignSpec; brand: BrandLook; label: string }) {
  return (
    <div className="lab-card">
      <DesignCanvas design={design} brand={brand} />
      <div className="meta">
        <b>{label}</b>
        <span>{design.format} · {design.aspect}</span>
      </div>
    </div>
  );
}

function BrandSection({ s, idx, photos }: { s: Sample; idx: number; photos: string[] }) {
  const { brand } = s;
  const P = brand.profile;
  const carousel = (t: TemplateId): DesignSpec => ({
    format: 'carousel',
    templateId: t,
    aspect: '4:5',
    slides: t === 'quote' ? [s.quote, { ...s.base[4]! }] : s.base,
    cta: s.cta,
    seed: idx * 11 + 3,
  });
  return (
    <section className="lab-brand" data-brand={idx}>
      <header>
        <h2>{brand.name}</h2>
        <span className="lab-sw">
          <i style={{ background: P.color }} />
          <i style={{ background: P.secondaryColor }} />
          <i style={{ background: P.accentColor }} />
        </span>
        <span className="muted">{P.fontHeading} + {P.fontBody}</span>
      </header>
      <h3>Grafika 4:5</h3>
      <div className="lab-grid" data-row="image">
        {TEMPLATES.map((t) => (
          <Card
            key={t.id}
            brand={brand}
            label={t.label}
            design={{ format: 'image', templateId: t.id, aspect: '4:5', slides: slidesFor(t.id, s), cta: t.id === 'bold' ? s.cta : undefined, seed: idx * 7 + 1 }}
          />
        ))}
      </div>
      <h3>Karusel (slide 1 a 2) </h3>
      <div className="lab-grid" data-row="carousel">
        {TEMPLATES.map((t) => (
          <div className="lab-card" key={t.id}>
            <div className="lab-pair">
              <DesignCanvas design={carousel(t.id)} brand={brand} slide={0} />
              <DesignCanvas design={carousel(t.id)} brand={brand} slide={1} />
            </div>
            <div className="meta"><b>{t.label}</b><span>karusel · {carousel(t.id).slides.length} slidů</span></div>
          </div>
        ))}
      </div>
      <h3>S fotkou + poslední slide s CTA + 1:1</h3>
      <div className="lab-grid" data-row="photo">
        {(['photo', 'split', 'editorial', 'gradient', 'bold'] as TemplateId[]).map((t, k) => (
          <Card
            key={t}
            brand={brand}
            label={`${TEMPLATES.find((x) => x.id === t)!.label} · fotka`}
            design={{ format: 'image', templateId: t, aspect: k === 4 ? '1:1' : '4:5', slides: [{ ...slidesFor(t, s)[0]!, mediaUrl: photos[(idx + k) % photos.length] }], seed: idx + k, cta: t === 'photo' ? s.cta : undefined }}
          />
        ))}
        {(['list', 'minimal', 'split'] as TemplateId[]).map((t) => (
          <div className="lab-card" key={`last-${t}`}>
            <DesignCanvas design={carousel(t)} brand={brand} slide={4} />
            <div className="meta"><b>{TEMPLATES.find((x) => x.id === t)!.label}</b><span>poslední slide · CTA</span></div>
          </div>
        ))}
      </div>
    </section>
  );
}

const STATUSES: PostStatus[] = ['scheduled', 'in_review', 'draft', 'published', 'published', 'published', 'published', 'published', 'published'];

/** Dev galerie pro vizuální kontrolu render enginu a mockupů. */
export function StudioLab() {
  const [filter, setFilter] = useState<number | null>(null);
  const photos = useMemo(
    () => (typeof document === 'undefined' ? [] : [makePhoto(7, '#d9773b', '#2b3a67'), makePhoto(19, '#c98a5a', '#6b8fb8'), makePhoto(31, '#b5523b', '#3f2a4f')]),
    [],
  );
  const reels = SAMPLES.map((s, i): DesignSpec => ({
    format: s.reel.variant === 'story' ? 'story' : 'reel',
    templateId: s.reel.templateId,
    aspect: '9:16',
    slides: s.reel.slides.map((sl, k) => (i === 0 ? { ...sl, mediaUrl: photos[k % photos.length] } : sl)),
    cta: s.reel.cta,
    seed: 4 + i,
    durationSec: s.reel.slides.length * 3,
  }));
  const [bakery, gym, build] = SAMPLES as [Sample, Sample, Sample];
  const feedPosts: FeedGridPost[] = TEMPLATES.concat(TEMPLATES.slice(0, 1)).map((t, k) => ({
    id: `p${k}`,
    design: {
      format: k === 1 ? 'reel' : k === 4 ? 'carousel' : 'image',
      templateId: t.id,
      aspect: k === 1 ? '9:16' : '4:5',
      slides: k === 4 ? gym.base : slidesFor(t.id, gym),
      cta: gym.cta,
      seed: k,
    },
    media: [],
    status: STATUSES[k] ?? 'published',
    publishedAt: null,
    scheduledAt: k === 0 ? '2026-11-12T09:00:00Z' : null,
  }));
  const shown = filter === null ? SAMPLES : [SAMPLES[filter]!];
  return (
    <div className="lab">
      <header>
        <h1>Studio Lab</h1>
        <p className="muted">Všechny šablony × formáty × ukázkové značky. Fonty se načítají z Google Fonts (offline se použije záložní písmo).</p>
        <div className="sp-chips" style={{ marginTop: 12 }}>
          <button type="button" className={`sp-chip ${filter === null ? 'on' : ''}`} onClick={() => setFilter(null)}>Vše</button>
          {SAMPLES.map((s, i) => (
            <button key={s.brand.name} type="button" className={`sp-chip ${filter === i ? 'on' : ''}`} onClick={() => setFilter(i)}>{s.brand.name}</button>
          ))}
        </div>
      </header>

      <section className="lab-brand" data-row="mockups">
        <h2>Reels, TikTok, Story</h2>
        <div className="lab-mock" data-row="reels">
          {SAMPLES.map((s, i) => (
            <PhoneReel key={i} brand={s.brand} design={reels[i]!} caption={s.caption} variant={s.reel.variant} playing />
          ))}
        </div>
        <h2>Feed mockupy</h2>
        <div className="lab-mock" data-row="feed">
          <InstagramPost
            brand={bakery.brand}
            design={{ format: 'carousel', templateId: 'editorial', aspect: '4:5', slides: bakery.base, cta: bakery.cta, seed: 4 }}
            caption={bakery.caption}
            scheduledAt="2026-11-08T08:00:00Z"
          />
          <FacebookPost
            brand={build.brand}
            design={{ format: 'image', templateId: 'photo', aspect: '4:5', slides: [{ ...build.base[0]!, mediaUrl: photos[1] }], seed: 2 }}
            caption={build.caption}
            scheduledAt="2026-11-10T16:30:00Z"
          />
          <LinkedInPost
            brand={build.brand}
            design={{ format: 'carousel', templateId: 'list', aspect: '4:5', slides: build.base, cta: build.cta, seed: 3 }}
            caption={'Než podepíšete smlouvu se stavební firmou, projděte si tyhle tři body. Ušetří vám nervy i peníze.\n\nCelý postup najdete v dokumentu níže. #stavba #rodinnydum'}
          />
          <FeedGrid brand={gym.brand} posts={feedPosts} stats={{ posts: 214, followers: 4820, following: 312 }} onReorder={(ids) => console.info('reorder', ids)} />
          <PreviewSwitcher
            brand={gym.brand}
            design={{ format: 'image', templateId: 'bold', aspect: '4:5', slides: [gym.offer], cta: gym.cta, seed: 5 }}
            captions={{ instagram: gym.caption, facebook: gym.caption, linkedin: 'Nový program silového tréninku pro firmy i jednotlivce.' }}
            networks={['instagram', 'facebook', 'linkedin']}
          />
          <PreviewSwitcher brand={gym.brand} design={reels[1]!} caption={gym.caption} networks={['instagram', 'facebook']} compact />
        </div>
      </section>

      {shown.map((s) => (
        <BrandSection key={s.brand.name} s={s} idx={SAMPLES.indexOf(s)} photos={photos} />
      ))}
    </div>
  );
}
