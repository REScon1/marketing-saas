import type { Brand, BrandProfile, Language, Network } from './types.js';
import { NETWORK_LIMITS } from './types.js';

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
        body: end(`${core}.${pickEmoji(p, 0)}\n\nCo z toho máte vy? Méně starostí a víc času na to podstatné. Podrobnosti najdete v odkazu.`),
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
}
