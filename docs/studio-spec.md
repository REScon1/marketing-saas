# Studio: specifikace přestavby (v2)

Cíl: aplikace pro agentury, jejímž jádrem je **tvorba hotového obsahu** (grafika, karusel, reel/story) ve značce klienta,
ne jen plánování textů. Vychází z rešerše konkurence (Predis, Blaze, Canva, Planable, Kontentino, Later, Opus Clip, Creatomate).

## Doménový model (packages/core)

```ts
export type PostFormat = 'image' | 'carousel' | 'reel' | 'story';
export type AspectRatio = '1:1' | '4:5' | '9:16';
export type FontId =
  | 'Onest' | 'Manrope' | 'DM Sans' | 'Montserrat' | 'Bricolage Grotesque' | 'Unbounded' | 'Archivo'
  | 'Fraunces' | 'Playfair Display' | 'Lora';

export interface DesignSlide {
  kicker?: string;      // malý nadtitulek (např. „NOVINKA“, „TIP #3“)
  headline: string;     // hlavní text (krátký, max ~70 znaků)
  body?: string;        // doplňující text (max ~160 znaků)
  mediaUrl?: string | null; // fotka/klip (data: nebo https:)
}

export interface DesignSpec {
  format: PostFormat;
  templateId: TemplateId;
  aspect: AspectRatio;          // image/carousel: 1:1 | 4:5; reel/story: 9:16
  slides: DesignSlide[];        // image: 1; carousel: 2–10; reel/story: 1–8 scén
  cta?: string;                 // výzva na poslední slide/scénu
  durationSec?: number;         // reel/story 6–60
  music?: string | null;        // id skladby (knihovna zatím prázdná)
  seed: number;                 // pro variabilitu pozadí
}

export type TemplateId = 'editorial' | 'bold' | 'photo' | 'quote' | 'list' | 'minimal' | 'split' | 'gradient';
```

`Post.design: DesignSpec | null` (nové pole; Postgres sloupec `design jsonb`). Validace v jádru (formát vs. počet slidů, délky textů, URL médií jako u `media`).

`BrandProfile` rozšířit (s výchozími hodnotami v `normalizeProfile`, Postgres beze změny schématu, je to JSONB):
`logoUrl: string | null`, `secondaryColor`, `accentColor` (hex), `fontHeading: FontId`, `fontBody: FontId`,
`pillars: string[]` (pilíře obsahu, max 8), `website: string | null`.

## AI asistent (rozhraní ContentAssistant)

```ts
interface Concept {
  angle: string;                 // „Benefit“, „Příběh“, „Otázka“, „Tip“, „Za oponou“…
  hook: string;                  // první věta / háček
  design: DesignSpec;            // hotový návrh vizuálu
  captions: Partial<Record<Network, string>>; // text pro každou zvolenou síť (délka a styl podle sítě)
  hashtags: string[];
  hookScore: number;             // 0–100, HEURISTIKA (délka háčku, otázka, číslo, emoce, CTA) – v UI tak označit
  why: string;                   // 1 věta proč
}
concepts(req: { brand; clientName; brief; format: PostFormat; networks; language; count }): Promise<Concept[]>
planMonth(req: { brand; month: 'YYYY-MM'; postsPerWeek: 2..7; networks; formats?: PostFormat[] }):
  Promise<{ date: string /* ISO s časem */; pillar: string; idea: string; format: PostFormat }[]>
```
`TemplateAssistant` (bez AI) musí dávat **kvalitní česká data**: různé úhly, rozumné háčky, karusely s logickou
posloupností (titulní slide → body → CTA), reel scény po 2–4 s. Prompty pro LLM v `buildConceptsPrompt`, `buildPlanPrompt`.

Služby: `ai.concepts(actor, {brandId, brief, format, networks, count?})`, `ai.planMonth(actor, {brandId, month, postsPerWeek, networks})`,
`content.createFromConcept(actor, {brandId, concept, scheduledAt?})` (vytvoří koncept postu s `design`, `overrides` z captions,
body = caption první sítě), `content.bulkCreateFromPlan(actor, {brandId, items})` (z plánu vytvoří koncepty s návrhem).
Vše přidat do RPC allowlistu.

## Render engine (apps/web/src/studio/render)

```ts
export const TEMPLATES: { id: TemplateId; label: string; formats: PostFormat[]; description: string }[];
export interface BrandLook { name: string; profile: BrandProfile }
export function sizeFor(aspect: AspectRatio): { w: number; h: number } // 1080×1080, 1080×1350, 1080×1920
export function drawFrame(ctx: CanvasRenderingContext2D, o: { design: DesignSpec; brand: BrandLook; slide: number; t: number; w: number; h: number; images: Map<string, HTMLImageElement> }): void
export function totalDuration(design: DesignSpec): number   // reel/story
export function sceneAt(design: DesignSpec, t: number): { index: number; local: number }
export async function exportPng(design, brand, slide): Promise<Blob>
export async function exportVideo(design, brand, onProgress?): Promise<Blob> // canvas.captureStream + MediaRecorder (webm/mp4 dle prohlížeče)
<DesignCanvas design brand slide={0} playing? className? />  // responzivní, devicePixelRatio, animace pro reel/story
```
Kvalita: žádné „dětské“ tvary. Typografie z brand fontů (Google Fonts, `document.fonts.load`), mřížka, okraje,
jemné mesh/gradient pozadí se zrnem, duotón přes fotky, logo/monogram značky, číslování slidů u karuselu, progress
u reelu, animace textu (slide-up, maska, kinetic captions), Ken Burns na fotkách, přechody scén.

## Náhledy (apps/web/src/studio/preview)

`<InstagramPost>` (karusel s tečkami a šipkami), `<PhoneReel>` (Reels/TikTok/Story chrome: ikony vpravo, popisek, audio řádek, progress story),
`<FacebookPost>`, `<LinkedInPost>`, `<FeedGrid>` (profil IG: hlavička se statistikami, mřížka 3 sloupce 4:5, přetahování pořadí),
`<PreviewSwitcher networks format …>` (přepínač sítí, vybere správný mockup). Vše s reálným jménem/handle/avatarem (logo značky).
