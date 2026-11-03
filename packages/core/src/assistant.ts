import {
  ANGLE_LABELS, derivePillars, templateConcepts, templatePlan,
  type Concept, type ConceptsRequest, type PlanItem, type PlanRequest, type PlanSlot,
} from './concepts.js';
import { SLIDE_RANGE } from './design.js';
import type { Brand, BrandProfile, Language, Network } from './types.js';
import { NETWORK_LIMITS, TEMPLATE_IDS } from './types.js';

// ---------- Kontrola proti brand profilu (deterministická, bez AI) ----------

export type IssueSeverity = 'error' | 'warning';

export interface BrandIssue {
  severity: IssueSeverity;
  code: 'empty' | 'no_network' | 'banned_word' | 'too_long' | 'too_many_hashtags' | 'emoji_policy';
  message: string;
  network?: Network;
}

const HASHTAG_RE = /(^|\s)#[\p{L}\p{N}_]+/gu;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

export function countHashtags(text: string): number {
  return (text.match(HASHTAG_RE) ?? []).length;
}

export function textForNetwork(body: string, overrides: Partial<Record<Network, string>>, n: Network): string {
  const o = overrides[n];
  return o !== undefined && o.trim() !== '' ? o : body;
}

export function brandCheck(
  input: { body: string; networks: Network[]; overrides?: Partial<Record<Network, string>> },
  profile: BrandProfile,
): BrandIssue[] {
  const issues: BrandIssue[] = [];
  const overrides = input.overrides ?? {};
  if (!input.body.trim()) issues.push({ severity: 'error', code: 'empty', message: 'Text postu je prázdný' });
  if (input.networks.length === 0) {
    issues.push({ severity: 'error', code: 'no_network', message: 'Vyberte aspoň jednu síť' });
  }

  const texts = new Set<string>([input.body, ...input.networks.map((n) => textForNetwork(input.body, overrides, n))]);
  const all = [...texts].join('\n').toLocaleLowerCase('cs');
  for (const word of profile.bannedWords) {
    const w = word.trim().toLocaleLowerCase('cs');
    if (w && all.includes(w)) {
      issues.push({ severity: 'error', code: 'banned_word', message: `Obsahuje zakázané slovo „${word.trim()}“` });
    }
  }

  for (const n of input.networks) {
    const t = textForNetwork(input.body, overrides, n);
    const limit = NETWORK_LIMITS[n].maxChars;
    if ([...t].length > limit) {
      issues.push({
        severity: 'error', code: 'too_long', network: n,
        message: `${NETWORK_LIMITS[n].label}: ${[...t].length} znaků, limit je ${limit}`,
      });
    }
    const tags = countHashtags(t);
    if (tags > profile.maxHashtags) {
      issues.push({
        severity: 'warning', code: 'too_many_hashtags', network: n,
        message: `${NETWORK_LIMITS[n].label}: ${tags} hashtagů, značka jich používá nejvýš ${profile.maxHashtags}`,
      });
    }
  }

  if (profile.emoji === 'none' && EMOJI_RE.test(all)) {
    issues.push({ severity: 'warning', code: 'emoji_policy', message: 'Značka emoji nepoužívá' });
  }
  return issues;
}

export const hasBlockingIssues = (issues: BrandIssue[]) => issues.some((i) => i.severity === 'error');

// ---------- Rozhraní AI asistenta ----------

export interface DraftRequest {
  brand: Brand;
  clientName: string;
  brief: string;
  networks: Network[];
  language: Language;
  variants: number;
}

export interface DraftVariant {
  body: string;
  /** Krátké zdůvodnění pro manažera, proč varianta vypadá takto. */
  angle: string;
}

export interface ReportSummaryInput {
  brandName: string;
  periodLabel: string;
  posts: number;
  reach: number;
  engagements: number;
  engagementRate: number;
  previous: { reach: number; engagements: number; engagementRate: number } | null;
  topPostTitle: string | null;
  bestNetwork: string | null;
}

export interface ContentAssistant {
  /** Popis pro UI, např. „Claude (Anthropic)“ nebo „Demo šablona“. */
  readonly label: string;
  readonly isAi: boolean;
  draft(req: DraftRequest): Promise<DraftVariant[]>;
  rewrite(req: { brand: Brand; body: string; instruction: string; language: Language }): Promise<string>;
  summarizeReport(input: ReportSummaryInput, language: Language): Promise<string>;
  /** Hotové koncepty postu (háček, návrh vizuálu, popisky pro sítě). */
  concepts(req: ConceptsRequest): Promise<Concept[]>;
  /** Měsíční plán: termíny (Europe/Prague), pilíř, formát a konkrétní nápad. */
  planMonth(req: PlanRequest): Promise<PlanItem[]>;
}

// ---------- Prompty pro LLM (sdílené, testovatelné) ----------

export function brandContext(brand: Brand, clientName: string): string {
  const p = brand.profile;
  const lines = [
    `Značka: ${brand.name} (klient ${clientName})`,
    `Tón hlasu: ${p.tone || 'neuveden'}`,
    `Cílové publikum: ${p.audience || 'neuvedeno'}`,
    `Emoji: ${{ none: 'nepoužívat', few: 'střídmě, nejvýš 1–2', many: 'klidně více' }[p.emoji]}`,
    `Hashtagy: nejvýš ${p.maxHashtags}${p.defaultHashtags.length ? `, preferované ${p.defaultHashtags.join(' ')}` : ''}`,
  ];
  if (p.bannedWords.length) lines.push(`Nikdy nepoužívej: ${p.bannedWords.join(', ')}`);
  if (p.examples.length) {
    lines.push('Ukázky postů, které značce sedí:');
    p.examples.slice(0, 5).forEach((e, i) => lines.push(`<ukazka ${i + 1}>\n${e}\n</ukazka ${i + 1}>`));
  }
  return lines.join('\n');
}

const LANG_NAME: Record<Language, string> = { cs: 'češtině', sk: 'slovenštině', en: 'angličtině' };

export function buildDraftPrompt(req: DraftRequest): { system: string; user: string } {
  const nets = req.networks.map((n) => `${NETWORK_LIMITS[n].label} (max ${NETWORK_LIMITS[n].maxChars} znaků)`).join(', ');
  const system = [
    'Jsi zkušený copywriter marketingové agentury. Píšeš posty na sociální sítě přesně v hlasu značky.',
    'Píšeš přirozeně, bez klišé a bez vymyšlených faktů. Když brief nějaký údaj neobsahuje (cena, datum, adresa), nevymýšlej ho.',
    'Výsledek vždy projde schválením člověkem; nic nepublikuješ.',
  ].join(' ');
  const user = [
    brandContext(req.brand, req.clientName),
    '',
    `Brief od manažera:\n<brief>\n${req.brief}\n</brief>`,
    '',
    `Napiš ${req.variants} odlišné varianty postu v ${LANG_NAME[req.language]} pro: ${nets}.`,
    'Každá varianta ať má jiný úhel (např. benefit, příběh, otázka na publikum).',
    'Odpověz pouze JSON ve tvaru {"variants":[{"angle":"krátký popis úhlu","body":"text postu"}]}.',
  ].join('\n');
  return { system, user };
}

export function buildRewritePrompt(req: { brand: Brand; body: string; instruction: string; language: Language }) {
  return {
    system: 'Jsi copywriter marketingové agentury. Upravuješ text postu podle pokynu a v hlasu značky. Nevymýšlej fakta.',
    user: [
      brandContext(req.brand, ''),
      '',
      `Původní text:\n<text>\n${req.body}\n</text>`,
      `Pokyn: ${req.instruction}`,
      `Odpověz pouze upraveným textem v ${LANG_NAME[req.language]}, bez komentáře.`,
    ].join('\n'),
  };
}

const NETWORK_STYLE: Record<Network, string> = {
  instagram: 'Instagram: kratší, vzdušný text s odřádkováním, výzva na konci, hashtagy na samostatném řádku na konci.',
  facebook: 'Facebook: konverzační tón, 2–4 krátké odstavce, výzva s odkazem (pokud značka nemá web, napiš zástupný text [odkaz]).',
  linkedin: 'LinkedIn: profesionálnější, 3–4 krátké odstavce, věcně, bez přehnaných emoji.',
};

const FORMAT_RULES = {
  image: 'Grafika: přesně 1 slide (kicker = krátký nadtitulek, headline = hlavní sdělení do 70 znaků, body = doplnění do 160 znaků).',
  carousel: 'Karusel: 4–7 slidů v logické posloupnosti – titulní slide (kicker + headline), 2–5 obsahových slidů (číslované tipy/kroky/fakta z briefu), závěrečný slide s výzvou k akci.',
  reel: 'Reel: 3–5 scén po 2–4 sekundách; text na obrazovce velmi krátký (do 45 znaků na scénu); první scéna je háček, poslední výzva. Popisek je samostatně v captions.',
  story: 'Story: 3–5 scén po 2–4 sekundách, text na obrazovce velmi krátký (do 45 znaků), poslední scéna s výzvou.',
} as const;

/** Prompt pro koncepty. Kontrakt výstupu je JSON {"concepts":[…]} (viz CONCEPTS_OUTPUT v API adaptéru). */
export function buildConceptsPrompt(req: ConceptsRequest): { system: string; user: string } {
  const range = SLIDE_RANGE[req.format];
  const system = [
    'Jsi kreativní ředitel a copywriter české marketingové agentury. Navrhuješ hotové posty na sociální sítě: háček, texty grafiky a popisky pro jednotlivé sítě – přesně v hlasu značky.',
    'Píšeš přirozenou češtinou bez klišé a bez prázdných frází (např. „Co z toho máte vy?“, „Neváhejte“, „To nejlepší pro vás“).',
    'Nevymýšlíš fakta: ceny, data, čísla, citace zákazníků ani jména, která nejsou v briefu. Když něco chybí, napiš to obecně nebo použij zástupný text v hranatých závorkách.',
    'Výsledek vždy projde schválením člověkem; nic nepublikuješ.',
  ].join(' ');
  const user = [
    brandContext(req.brand, req.clientName),
    req.brand.profile.pillars.length ? `Pilíře obsahu: ${req.brand.profile.pillars.join(', ')}` : '',
    req.brand.profile.website ? `Web značky: ${req.brand.profile.website}` : 'Web značky: není (v odkazu použij [odkaz])',
    '',
    `Brief od manažera:\n<brief>\n${req.brief}\n</brief>`,
    '',
    `Navrhni ${req.count} odlišné koncepty v ${LANG_NAME[req.language]} ve formátu „${req.format}“.`,
    FORMAT_RULES[req.format],
    `Počet slidů/scén: ${range.min}–${range.max}. Limity: kicker do 30 znaků, headline do 70 znaků, body do 160 znaků, cta do 40 znaků.`,
    `Každý koncept ať má jiný úhel – vyber z: ${Object.values(ANGLE_LABELS).join(', ')}.`,
    'Háček (hook) je první věta popisku: silná, konkrétní, do 90 znaků.',
    `Popisky (captions) napiš pro sítě: ${req.networks.map((n) => NETWORK_LIMITS[n].label).join(', ')}.`,
    ...req.networks.map((n) => `- ${NETWORK_STYLE[n]}`),
    `Šablona (templateId) jedna z: ${TEMPLATE_IDS.join(', ')} – list pro tipy v karuselu, bold pro nabídky, quote pro citace, photo/split pokud brief zmiňuje fotky, jinak editorial/gradient/minimal.`,
    'why = jedna česká věta, proč koncept funguje.',
    'Odpověz pouze JSON ve tvaru {"concepts":[{"angle":"…","hook":"…","templateId":"…","slides":[{"kicker":"…","headline":"…","body":"…"}],"cta":"…","durationSec":12,"captions":{"instagram":"…"},"hashtags":["#…"],"why":"…"}]}.',
  ].filter((l) => l !== '').join('\n');
  return { system, user };
}

/** Prompt pro nápady do měsíčního plánu. Termíny, pilíře a formáty určuje kód, model doplní jen nápady. */
export function buildPlanPrompt(req: PlanRequest, slots: PlanSlot[]): { system: string; user: string } {
  const system = [
    'Jsi stratég obsahu české marketingové agentury. Vymýšlíš konkrétní, pestré nápady na posty, které sedí značce, pilíři i formátu.',
    'Nápady nesmí vymýšlet fakta (ceny, data akcí, jména), která o značce nevíš. Žádná klišé.',
  ].join(' ');
  const pillars = derivePillars(req.brand.profile);
  const user = [
    brandContext(req.brand, ''),
    `Pilíře obsahu: ${pillars.join(', ')}`,
    `Měsíc: ${req.month}`,
    '',
    'Rozvrh (index, datum a čas, pilíř, formát):',
    ...slots.map((s, i) => `${i}. ${s.date} | ${s.pillar} | ${s.format}`),
    '',
    'Ke každé položce rozvrhu napiš jeden konkrétní nápad v češtině jako krátký titulek (do 100 znaků). Nápady se nesmí opakovat.',
    'Odpověz pouze JSON ve tvaru {"items":[{"index":0,"idea":"…"}]} se všemi indexy rozvrhu.',
  ].join('\n');
  return { system, user };
}

// ---------- Demo asistent bez AI ----------

const fmtPct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')} %`;
const fmtNum = (x: number) => Math.round(x).toLocaleString('cs-CZ');

function pickEmoji(profile: BrandProfile, i: number): string {
  if (profile.emoji === 'none') return '';
  const set = ['✨', '👉', '🙌', '💡', '📣'];
  return ` ${set[i % set.length]}`;
}

/**
 * Deterministický „asistent“ pro demo a testy. Skládá text ze šablon a brand profilu.
 * Není to AI a UI to musí jasně říkat.
 */
export class TemplateAssistant implements ContentAssistant {
  readonly label = 'Demo šablona (bez AI)';
  readonly isAi = false;

  async draft(req: DraftRequest): Promise<DraftVariant[]> {
    const p = req.brand.profile;
    const brief = req.brief.trim().replace(/\s+/g, ' ');
    const core = brief.length > 0 ? brief.charAt(0).toUpperCase() + brief.slice(1) : 'Novinka od nás';
    const tags = p.defaultHashtags.slice(0, p.maxHashtags).join(' ');
    const end = (s: string) => (tags ? `${s}\n\n${tags}` : s);
    const variants: DraftVariant[] = [
      {
        angle: 'Benefit na první řádek',
        body: end(`${core}.${pickEmoji(p, 0)}\n\nPodrobnosti najdete v odkazu.`),
      },
      {
        angle: 'Otázka na publikum',
        body: end(`Znáte to? ${core.replace(/\.$/, '')}.${pickEmoji(p, 1)}\n\nNapište nám do komentářů, jak to máte vy.`),
      },
      {
        angle: 'Krátký příběh',
        body: end(`Minulý týden se nás jeden zákazník zeptal, jestli to jde jednodušeji. Šlo.${pickEmoji(p, 2)}\n\n${core}.`),
      },
    ];
    return variants.slice(0, Math.max(1, Math.min(req.variants, variants.length)));
  }

  async rewrite(req: { brand: Brand; body: string; instruction: string }): Promise<string> {
    const i = req.instruction.toLowerCase();
    let t = req.body;
    if (i.includes('krat') || i.includes('zkrat') || i.includes('short')) {
      t = t.split(/\n\n/)[0] ?? t;
    }
    if (i.includes('formal') || i.includes('vyk')) {
      t = t.replace(/\bmáš\b/g, 'máte').replace(/\bnapiš\b/gi, 'napište');
    }
    if (req.brand.profile.emoji === 'none') t = t.replace(EMOJI_RE, '').replace(/ {2,}/g, ' ');
    return t.trim();
  }

  async summarizeReport(r: ReportSummaryInput): Promise<string> {
    if (r.posts === 0) return `V období ${r.periodLabel} nebyl pro značku ${r.brandName} publikován žádný post.`;
    const parts = [
      `V období ${r.periodLabel} jsme pro ${r.brandName} publikovali ${r.posts} ${r.posts === 1 ? 'post' : r.posts < 5 ? 'posty' : 'postů'} s dosahem ${fmtNum(r.reach)} a ${fmtNum(r.engagements)} interakcemi (míra zapojení ${fmtPct(r.engagementRate)}).`,
    ];
    if (r.previous && r.previous.reach > 0) {
      const d = (r.reach - r.previous.reach) / r.previous.reach;
      parts.push(`Dosah je ${d >= 0 ? 'vyšší' : 'nižší'} o ${fmtPct(Math.abs(d))} než v předchozím měsíci.`);
    }
    if (r.topPostTitle) parts.push(`Nejlépe fungoval post „${r.topPostTitle}“.`);
    if (r.bestNetwork) parts.push(`Nejsilnější síť: ${r.bestNetwork}.`);
    return parts.join(' ');
  }

  async concepts(req: ConceptsRequest): Promise<Concept[]> {
    return templateConcepts(req);
  }

  async planMonth(req: PlanRequest): Promise<PlanItem[]> {
    return templatePlan(req);
  }
}
