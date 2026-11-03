import { isVideoFormat, seedFrom, SLIDE_RANGE, validDesign } from './design.js';
import type { Brand, BrandProfile, DesignSlide, DesignSpec, Language, Network, PostFormat, TemplateId } from './types.js';
import { POST_FORMATS, TEMPLATE_IDS } from './types.js';

// Studio: koncepty postů (háček + návrh vizuálu + texty pro sítě) a měsíční plán.
// TemplateAssistant je deterministický – skládá text z briefu a brand profilu bez AI.
// Zásada: nevymýšlet fakta. Co v briefu není (cena, datum, citace), v textu nebude.

// ---------- Typy ----------

export type ConceptAngle = 'benefit' | 'story' | 'question' | 'tip' | 'offer' | 'proof';

export const ANGLE_LABELS: Record<ConceptAngle, string> = {
  benefit: 'Benefit',
  story: 'Za oponou',
  question: 'Otázka',
  tip: 'Tip',
  offer: 'Nabídka',
  proof: 'Sociální důkaz',
};

export interface Concept {
  /** Úhel („Benefit“, „Za oponou“, „Otázka“, „Tip“, „Nabídka“, „Sociální důkaz“…). */
  angle: string;
  /** První věta / háček. */
  hook: string;
  design: DesignSpec;
  /** Text pro každou zvolenou síť (délka a styl podle sítě). */
  captions: Partial<Record<Network, string>>;
  hashtags: string[];
  /** 0–100, HEURISTIKA (viz `hookScore`), ne predikce výkonu. */
  hookScore: number;
  /** Jedna věta, proč koncept funguje. */
  why: string;
}

export interface ConceptsRequest {
  brand: Brand;
  clientName: string;
  brief: string;
  format: PostFormat;
  networks: Network[];
  language: Language;
  count: number;
}

export interface PlanRequest {
  brand: Brand;
  /** RRRR-MM */
  month: string;
  /** 2–7 */
  postsPerWeek: number;
  networks: Network[];
  formats?: PostFormat[];
  /** Okamžik „teď“ (ISO); termíny v minulosti se vynechají. */
  now: string;
}

export interface PlanSlot {
  /** ISO v UTC (místní čas Europe/Prague převedený na UTC). */
  date: string;
  pillar: string;
  format: PostFormat;
}

export interface PlanItem extends PlanSlot {
  /** Konkrétní nápad (titulek) v češtině. */
  idea: string;
}

export const MAX_CONCEPTS = 6;

// ---------- Drobné textové pomůcky ----------

const UPPER = 'A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ';
const EMOJI_RE = /\p{Extended_Pictographic}️?/gu;
const HASHTAG_RE = /(^|\s)#[\p{L}\p{N}_]+/gu;

const len = (s: string) => [...s].length;
const capFirst = (s: string) => (s ? s.charAt(0).toLocaleUpperCase('cs') + s.slice(1) : s);
const stripEnd = (s: string) =>
  /\d{1,2}\.\s?\d{1,2}\.\s*$/u.test(s) ? s.trim() : s.replace(/[\s.!?…,;:–-]+$/u, '').trim(); // „do 10. 12.“ si tečku nechá
const QUESTION_START = /^(jak|proč|kolik|čím)\s/iu;
const sentence = (s: string) => {
  const t = s.trim();
  if (!t) return '';
  if (/[.!?…“"]$/u.test(t)) return t;
  return QUESTION_START.test(t) ? `${t}?` : `${t}.`;
};

/** Zkrátí text na max znaků: nejdřív na hranici věty/části (bez výpustky), jinak na hranici slova s „…“. */
export function shorten(text: string, max: number): string {
  const t = text.trim();
  if (len(t) <= max) return t;
  const chars = [...t];
  const head = chars.slice(0, max + 1).join('');
  const clause = Math.max(head.lastIndexOf(', '), head.lastIndexOf(' – '), head.lastIndexOf(': '), head.lastIndexOf('. '));
  if (clause >= max * 0.45) return stripEnd(head.slice(0, clause));
  const sp = head.lastIndexOf(' ', max - 1);
  const cut = sp > max * 0.3 ? head.slice(0, sp) : chars.slice(0, max - 1).join('');
  return `${stripEnd(cut)}…`;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Odstraní zakázaná slova značky (case-insensitive) a uklidí mezery okolo. */
export function scrubBanned(text: string, banned: string[]): string {
  let t = text;
  let hit = false;
  for (const w of banned) {
    const word = w.trim();
    if (!word) continue;
    const re = new RegExp(escapeRe(word), 'giu');
    if (re.test(t)) {
      hit = true;
      t = t.replace(re, '');
    }
  }
  if (!hit) return text;
  return t
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.,!?;:])/g, '$1')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .replace(/([.!?])\1+/g, '$1')
    .replace(/(^|[.!?]\s+|\n)(\p{Ll})/gu, (_m, pre: string, ch: string) => pre + ch.toLocaleUpperCase('cs'))
    .trim();
}

function containsBanned(text: string, banned: string[]): number {
  const low = text.toLocaleLowerCase('cs');
  return banned.filter((w) => w.trim() && low.includes(w.trim().toLocaleLowerCase('cs'))).length;
}

// ---------- Heuristika háčku ----------

const SECOND_PERSON_RE =
  /(?<![\p{L}])(vy|vás|vám|váš|vaše|vaši|ty|tě|ti|tvůj|tvoje|tobě|máte|máš|víte|víš|chcete|chceš|zkuste|zkus|přijďte|přijď|uložte|ulož|děláte|děláš|znáte|znáš|nenechte|nenech|zastavte|zastav|podívejte|podívej)(?![\p{L}])/iu;
const URGENCY_RE =
  /(?<![\p{L}])(dnes|dneska|teď|hned|jen do|už jen|poslední|naposledy|zítra|tento týden|tenhle týden|do neděle|do pátku|do soboty|omezen|nenechte si ujít|nenech si ujít)(?![\p{L}])/iu;

/**
 * HEURISTIKA síly háčku 0–100 (žádná predikce dosahu). Bodování:
 * základ 45; délka 20–70 znaků +15 (71–100 +5, pod 12 −10, nad 120 −15); otázka +10; číslo +10;
 * oslovení ve 2. osobě +8; naléhavost/termín +8; víc než jeden vykřičník −5; slova VELKÝMI −5;
 * každé zakázané slovo značky −30. Výsledek se ořízne do 0–100.
 */
export function hookScore(hook: string, profile: Pick<BrandProfile, 'bannedWords'>): number {
  const h = hook.trim();
  const n = len(h);
  let s = 45;
  if (n >= 20 && n <= 70) s += 15;
  else if (n > 70 && n <= 100) s += 5;
  else if (n < 12) s -= 10;
  else if (n > 120) s -= 15;
  if (h.includes('?')) s += 10;
  if (/\d/.test(h)) s += 10;
  if (SECOND_PERSON_RE.test(h)) s += 8;
  if (URGENCY_RE.test(h)) s += 8;
  if ((h.match(/!/g) ?? []).length > 1) s -= 5;
  if ((h.match(new RegExp(`(?<![\\p{L}])[${UPPER}]{4,}(?![\\p{L}])`, 'gu')) ?? []).length > 0) s -= 5;
  s -= 30 * containsBanned(h, profile.bannedWords);
  return Math.max(0, Math.min(100, Math.round(s)));
}

// ---------- Rozbor briefu ----------

const DAYS = 'pondělí|úterý|středu|čtvrtek|pátek|sobotu|neděli';
const DEADLINE_DAYS = 'pondělí|úterý|středy|čtvrtka|pátku|soboty|neděle';
const SUBORDINATE = /^(který|která|které|kterého|kterou|kterých|kterým|kteří|že|aby|kde|když|co|což|jak|protože|jestli|než)\b/iu;

interface Brief {
  label: string | null;
  topic: string;
  points: string[];
  offer: boolean;
  photo: boolean;
  testimonial: boolean;
  tip: boolean;
  event: boolean;
  process: boolean;
  news: boolean;
  day: string | null;
  deadline: string | null;
  quote: string | null;
  numberPoint: string | null;
  /** Doplněné obecné body (brief neměl dost faktů). */
  fallback: boolean;
  /** Téma je číslovaný výčet („5 nejčastějších chyb…“). */
  listCount?: number;
}

function cleanBrief(raw: string): string {
  return raw
    .replace(HASHTAG_RE, ' ')
    .replace(EMOJI_RE, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function splitSentences(text: string): string[] {
  return text
    .split(/\n+|;\s+/)
    .flatMap((l) => l.split(new RegExp(`(?:(?<=[.!?…])\\s+(?=[${UPPER}„"])|(?<=[^\\d\\s][.!?…])\\s+(?=\\d))`, 'u')))
    .map((s) => stripEnd(s.trim()))
    .filter((s) => len(s) > 1);
}

/** Rozdělí větu podle čárek, ale vedlejší věty a jednoslovné výčty nechá pohromadě. */
function splitClauses(s: string, minWords = 4): string[] {
  const parts = s.split(/,\s+/);
  const out: string[] = [];
  for (const p of parts) {
    const words = p.trim().split(/\s+/).length;
    if (out.length && (SUBORDINATE.test(p.trim()) || words < minWords)) out[out.length - 1] += `, ${p.trim()}`;
    else out.push(p.trim());
  }
  return out.filter(Boolean);
}

const has = (t: string, re: RegExp) => re.test(t);

function analyze(rawBrief: string, audience: string): Brief {
  const text = cleanBrief(rawBrief);
  const low = text.toLocaleLowerCase('cs');
  let sentences = splitSentences(text);
  if (!sentences.length) sentences = ['Novinka od nás'];

  // „Novinka: …“, „Kvas a řemeslo: …“ → štítek do nadtitulku
  let label: string | null = null;
  // „Jak začít s posilováním: a, b, c“ → téma před dvojtečkou, výčet za ní jsou body
  // „Firemní členství: jedna faktura, přístup pro tým“ → téma + výčet; „Novinka: žitný chléb“ → štítek + téma
  const m = /^([^:]{2,80}):\s+(.+)$/u.exec(sentences[0]!);
  if (m) {
    const prefix = m[1]!.trim();
    const rest = m[2]!.trim();
    const list = splitClauses(rest, 1);
    const isLabel = prefix.split(/\s+/).length <= 4 && !/\d/.test(prefix) && !QUESTION_START.test(prefix);
    if (QUESTION_START.test(prefix) || list.length >= 2 || !isLabel) {
      sentences.splice(0, 1, prefix, ...(list.length >= 2 ? list : [rest]).map(capFirst));
    } else {
      label = prefix;
      sentences[0] = capFirst(rest);
    }
  }
  // „Hotovo!“, „Rozšiřujeme tým!“ → nadtitulek, tématem je další věta
  if (!label && sentences.length > 1 && sentences[0]!.split(/\s+/).length <= 2) {
    label = sentences.shift()!;
  }

  let topic = sentences[0]!;
  let points = sentences.slice(1);
  if (len(topic) > 90) {
    const [head, ...rest] = splitClauses(topic);
    if (head && rest.length) {
      topic = head;
      points = [...rest.map(capFirst), ...points];
    }
  }
  if (points.length < 2) {
    const more = points.flatMap((p) => splitClauses(p)).map(capFirst);
    if (more.length > points.length) points = more;
  }
  points = points.map(stripEnd).filter((p) => len(p) > 2 && p.toLocaleLowerCase('cs') !== topic.toLocaleLowerCase('cs'));

  const quoteM = /[„"]([^“"]{25,160})[“"]/u.exec(text);
  const dayM = new RegExp(`(?<![\\p{L}])((?:ve?|každ[ýéou]+)\\s+(?:${DAYS}))(?![\\p{L}])`, 'iu').exec(text);
  const deadlineM = new RegExp(`(?<![\\p{L}])(do\\s+(?:${DEADLINE_DAYS}|\\d{1,2}\\.\\s?\\d{1,2}\\.|konce\\s+\\p{L}+|vyprodání\\s+zásob))(?![\\p{L}])`, 'iu').exec(text);
  // Číslo jako důkaz (množství, výsledek), ne cena, čas nebo datum
  const numberPoint = [topic, ...points].find((p) => /\d/.test(p.replace(/\d+([.,]\d+)?\s?(kč|czk|€|%|,-)|\d{1,2}:\d{2}|\d{1,2}\.\s?\d{1,2}\./giu, ''))) ?? null;

  const b: Brief = {
    label,
    topic,
    points,
    offer: has(low, /(sleva|slevu|slevy|akce|akci|zdarma|nabídk|poukaz|dárk|dárek|výprodej|\d\s?%|\d\s?kč|cena|ceny|v ceně)/u),
    photo: has(low, /(fotk|fotografi|foto |fotek|snímk|obráz|video|záběr|galeri)/u),
    testimonial: !!quoteM || has(low, /(recenz|hodnocen|ohlas|napsal[a]? nám|píše nám|říká nám|příběh)/u),
    tip: has(low, /(tip|rada|rady|návod|postup|krok|jak (na|si|začít|poznat|vybrat|na to)|chyb)/u),
    event: !!dayM || has(low, /(zveme|pozvánk|přijďte|přijď|den otevřených|registrac|workshop|lekce|vybíháme|zdobíme)/u),
    process: has(low, /(pečeme|vyrábíme|stavíme|připravujeme|chystáme|trénujeme|děláme|ručně|ruční|řemesl|tým|zákulis|dílna|výrob|postup|dokončili|začali|zahájili|stavb)/u),
    news: has(low, /(novinka|nově|nový|nová|nové|spouštíme|otevíráme|otevřeli|nově otevřen|představujeme|hotovo|jsou zpět|je zpět)/u),
    day: dayM ? dayM[1]!.toLocaleLowerCase('cs').replace(/^každ\p{L}+\s+/u, (_x) => (/^každ\p{L}+\s+(středu|čtvrtek)/u.test(dayM[1]!.toLocaleLowerCase('cs')) ? 've ' : 'v ')) : null,
    deadline: deadlineM ? deadlineM[1]!.toLocaleLowerCase('cs') : null,
    quote: quoteM ? quoteM[1]!.trim() : null,
    numberPoint,
    fallback: false,
  };

  const listM = /(?<![\p{L}\d])(\d{1,2})\s+(?:\p{L}+\s+)?(chyb|tip|krok|důvod|věc|rad|mýt|otáz|způsob|trik)/iu.exec(topic);
  if (listM) b.listCount = Math.min(Math.max(Number(listM[1]), 2), 5);
  if (b.points.length === 0) {
    // Brief je jen titulek (např. nápad z plánu): kostra s výzvou k doplnění, žádná vymyšlená fakta.
    b.fallback = true;
    if (listM) {
      const label = LIST_LABEL[listM[2]!.toLocaleLowerCase('cs')] ?? 'Bod';
      b.points = Array.from({ length: b.listCount! }, (_, i) => `${label} ${i + 1}: [doplňte z praxe]`);
    } else {
      const who = shortAudience(audience);
      b.points = [
        'Proč na tom záleží: [doplňte hlavní přínos]',
        who ? `Pro koho: ${lcFirst(who, text)}` : 'Pro koho: [doplňte]',
        'Jak začít: [doplňte první krok]',
      ];
    }
  }
  return b;
}

const LIST_LABEL: Record<string, string> = {
  chyb: 'Chyba', tip: 'Tip', krok: 'Krok', důvod: 'Důvod', věc: 'Věc', rad: 'Rada', mýt: 'Mýtus', otáz: 'Otázka', způsob: 'Způsob', trik: 'Trik',
};

function shortAudience(a: string): string {
  const first = a.split(/[,.;]/)[0]?.trim() ?? '';
  return len(first) >= 4 && len(first) <= 60 ? first : '';
}

/** Malé první písmeno, pokud nejde zjevně o vlastní jméno (slovo jinde v textu velkým uprostřed věty). */
function lcFirst(s: string, context: string): string {
  const word = s.split(/\s+/)[0] ?? '';
  if (!word) return s;
  if (word.length === 1) return word.toLocaleLowerCase('cs') + s.slice(1); // „V sobotu…“ → „v sobotu…“
  if (word === word.toLocaleUpperCase('cs')) return s; // zkratka
  if (word.charAt(1) !== word.charAt(1).toLocaleLowerCase('cs')) return s; // FitZóna, iPhone
  const midSentence = new RegExp(`[\\p{Ll},]\\s+${escapeRe(word)}(?![\\p{L}])`, 'u');
  if (midSentence.test(context)) return s;
  return word.charAt(0).toLocaleLowerCase('cs') + s.slice(1);
}

const VERB_WORD = /^(zkus|zkuste|pojď|pojďte|dej|kup|ulož|napiš|mrkni|sleduj|začni|domluv|je|jsou|jsme|jste|byl\p{L}*|bude\p{L}*|budeme|má|mají|máme|máte|mám|můžete|můžeš|chceme|chcete)$|(eme|íme|áme|ete|íte|áte|il|ila|ili|ily|al|ala|ali|aly|el|ela|eli|ěl|ěla|ěli|ďte|ejte|ijte|ěte|ď|j)$/iu;

/** Hrubý odhad, jestli je text jmenná fráze („Žitný chléb se slunečnicí“) a ne věta se slovesem. */
function isNounPhrase(s: string): boolean {
  return !s.split(/[\s,]+/).some((w) => VERB_WORD.test(w.replace(/[^\p{L}]/gu, '')));
}

const DANGLING = new Set(['v', 've', 'na', 'do', 's', 'se', 'z', 'ze', 'k', 'ke', 'o', 'u', 'a', 'i', 'pro', 'za', 'od', 'po', 'při', 'bez', 'než', 'že', 'nebo', 'ani', 'jak', 'co', 'kde', 'který', 'která', 'které', 'jsme', 'je', 'přímo', 'hned', 'až', 'už', 'jen']);

/** Krátký text na obrazovku: celé slovo, bez výpustky, bez visící předložky na konci. */
export function compact(text: string, max: number): string {
  const q = text.trim().endsWith('?') ? '?' : '';
  const t = stripEnd(text);
  if (len(t) + q.length <= max) return t + q;
  const clause = shorten(t, max);
  if (!clause.endsWith('…')) return clause;
  const words = clause.slice(0, -1).trim().split(/\s+/);
  // „…halu v pasivním“ → „…halu“: neúplná předložková vazba na konci pryč
  if (words.length > 4 && DANGLING.has(words[words.length - 2]!.toLocaleLowerCase('cs'))) words.splice(-2);
  while (words.length > 2 && DANGLING.has(words[words.length - 1]!.toLocaleLowerCase('cs'))) words.pop();
  return stripEnd(words.join(' ')) + q;
}

// ---------- Hlas značky ----------

interface Voice {
  ty: boolean;
  b2b: boolean;
  emoji: BrandProfile['emoji'];
  t: (ty: string, vy: string) => string;
  link: string;
}

function voiceOf(brand: Brand): Voice {
  const p = brand.profile;
  const tone = `${p.tone} ${p.audience}`.toLocaleLowerCase('cs');
  const ty = /tyk/u.test(tone) && !/vyk/u.test(p.tone.toLocaleLowerCase('cs'));
  const b2b = /(vyk|odborn|investor|developer|firm|b2b|manažer|ředitel)/u.test(tone);
  return {
    ty,
    b2b,
    emoji: p.emoji,
    t: (a, b) => (ty ? a : b),
    link: p.website ?? '[odkaz]',
  };
}

const ANGLE_EMOJI: Record<ConceptAngle, string> = { benefit: '✨', story: '👀', question: '💬', tip: '💡', offer: '🎁', proof: '⭐' };

const vecí = (n: number) => (n >= 2 && n <= 4 ? 'věci' : 'věcí');
const krocich = (n: number) => `${n >= 2 && n <= 4 ? 've' : 'v'} ${n} krocích`;

// ---------- Úhly ----------

function rankAngles(b: Brief, format: PostFormat): ConceptAngle[] {
  const base: ConceptAngle[] = ['benefit', 'story', 'question', 'tip', 'offer', 'proof'];
  const score: Record<ConceptAngle, number> = { benefit: 5, story: 3, question: 3, tip: 3, offer: 1, proof: 1 };
  if (b.offer) score.offer += 6;
  if (b.testimonial) score.proof += 6;
  else if (b.numberPoint) score.proof += 5;
  if (b.tip) score.tip += 5;
  if (b.news) score.benefit += 2;
  if (b.event) score.question += 2;
  if (format === 'carousel' && (b.tip || b.listCount)) score.tip += 3;
  if (isVideoFormat(format)) score.story += 2;
  const eligible = base.filter((a) => {
    if (a === 'proof') return !b.fallback && (b.testimonial || !!b.numberPoint);
    if (a === 'offer') return b.offer || b.event || !!b.deadline;
    if (a === 'tip') return b.tip || format === 'carousel';
    if (a === 'story') return isVideoFormat(format) || (!b.fallback && (b.process || b.testimonial));
    return true;
  });
  return eligible.sort((x, y) => score[y] - score[x] || base.indexOf(x) - base.indexOf(y));
}

interface Copy {
  hook: string;
  /** Krátká verze na první scénu reelu / titulek grafiky (do ~45 znaků). */
  short: string;
  kicker: string;
  cta: string;
  ctaShort: string;
  why: string;
  /** Háček už obsahuje téma, v popisku ho neopakovat. */
  hookHasTopic: boolean;
}

/** Body tipu: se štítkem („Předsevzetí, která vydrží: …“) je i samotné téma jedním z tipů. */
function tipItems(b: Brief): string[] {
  return b.label && !b.fallback && !b.listCount ? [b.topic, ...b.points] : b.points;
}

function bestPoint(b: Brief): string | null {
  const benefit = /(vydrží|ušetří|stihneš|stihnete|zdarma|v ceně|denně|čerstv|poctiv)/iu;
  if (b.fallback) return null;
  return b.points.find((p) => benefit.test(p)) ?? b.points.find((p) => /\d/.test(p)) ?? b.points[0] ?? null;
}

function copyFor(angle: ConceptAngle, b: Brief, v: Voice, format: PostFormat, ctx: string): Copy {
  const { t } = v;
  const topic = b.topic;
  const lcTopic = lcFirst(topic, ctx);
  const noun = isNounPhrase(topic);
  const n = Math.min(Math.max(b.points.length, 2), 5);
  switch (angle) {
    case 'benefit': {
      const bp = bestPoint(b);
      const head = b.news && !/^nov/iu.test(topic) && noun ? sentence(`Novinka: ${lcTopic}`) : sentence(topic);
      const hook = bp && len(head) + len(bp) < 110 ? `${head} ${sentence(bp)}` : head;
      return {
        hook,
        short: compact(topic, 45),
        kicker: (b.label && len(b.label) <= 30 ? b.label : b.news ? 'Novinka' : b.event ? 'Pozvánka' : 'Stojí za to').toLocaleUpperCase('cs'),
        cta: v.b2b
          ? 'Chcete znát podrobnosti? Napište nám, rádi je probereme.'
          : t('Zastav se u nás, rádi tě uvidíme.', 'Zastavte se u nás, rádi vás uvidíme.'),
        ctaShort: v.b2b ? 'Napište nám' : b.event ? t('Přijď', 'Přijďte') : t('Zastav se u nás', 'Zastavte se u nás'),
        why: 'Hlavní přínos je hned v první větě – i ten, kdo jen scrolluje, ho pochopí za dvě vteřiny.',
        hookHasTopic: true,
      };
    }
    case 'story': {
      const hook = b.testimonial && !b.quote && noun ? sentence(topic) : sentence(`Pohled do zákulisí: ${lcTopic}`);
      return {
        hook,
        short: compact(topic, 45),
        kicker: b.testimonial && !b.quote ? 'PŘÍBĚH' : 'ZA OPONOU',
        cta: t('Chceš vidět víc ze zákulisí? Napiš nám do komentářů.', 'Chcete vidět víc ze zákulisí? Napište nám do komentářů.'),
        ctaShort: t('Sleduj nás dál', 'Sledujte nás dál'),
        why: 'Pohled do zákulisí buduje důvěru a působí lidsky, ne jako reklama.',
        hookHasTopic: true,
      };
    }
    case 'question': {
      let hook: string;
      let hasTopic = false;
      if (/^jak\s/iu.test(topic)) {
        hook = `${stripEnd(topic)}?`;
        hasTopic = true;
      } else if (b.day) hook = t(`Co děláš ${b.day}?`, `Co děláte ${b.day}?`);
      else if (noun && len(topic) <= 60 && !b.listCount) {
        hook = `${t('Co ty na to', 'Co vy na to')}: ${stripEnd(lcTopic)}?`;
        hasTopic = true;
      } else if (v.b2b) hook = 'Řešíte podobný projekt?';
      else hook = t('Jak to máš ty?', 'Jak to máte vy?');
      return {
        hook,
        short: compact(hook, 45),
        kicker: t('OTÁZKA PRO TEBE', 'OTÁZKA PRO VÁS'),
        cta: v.b2b ? 'Napište nám do komentářů, jak to vidíte vy.' : t('Napiš nám to do komentáře, čteme všechno.', 'Napište nám to do komentářů, čteme všechny.'),
        ctaShort: t('Napiš do komentáře', 'Napište do komentářů'),
        why: 'Otázka zve ke komentářům a konverzace pod postem mu přidá dosah.',
        hookHasTopic: hasTopic,
      };
    }
    case 'tip': {
      const n = Math.min(Math.max(tipItems(b).length, 2), 5);
      const how = /^jak\s/iu.test(topic);
      const count = `${n} ${vecí(n)}, které stojí za to vědět`;
      const tipy = `${n} ${n >= 2 && n <= 4 ? 'tipy' : 'tipů'}`;
      const hook = b.listCount
        ? sentence(topic)
        : b.label && !b.fallback
        ? `${b.label}: ${tipy}.`
        : how
        ? `${stripEnd(topic)}? ${capFirst(krocich(n))}.`
        : noun && len(topic) <= 60
          ? `${stripEnd(topic)}: ${count}.`
          : `${capFirst(count)}.`;
      return {
        hook,
        short: b.listCount ? compact(topic, 60) : b.label && !b.fallback ? compact(`${b.label}: ${tipy}`, 60) : how ? compact(`${stripEnd(topic)}?`, 45) : capFirst(count),
        kicker: how ? 'JAK NA TO' : 'TIP',
        cta: format === 'carousel'
          ? t('Ulož si to, ať to máš po ruce, a pošli to někomu, komu se to bude hodit.', 'Uložte si to, ať to máte po ruce, a pošlete to někomu, komu se to bude hodit.')
          : t('Pošli to někomu, komu se to bude hodit.', 'Pošlete to někomu, komu se to bude hodit.'),
        ctaShort: t('Ulož si to', 'Uložte si to'),
        why: 'Praktická rada má hodnotu i bez nákupu – lidé si ji ukládají a posílají dál.',
        hookHasTopic: !!b.listCount || how || !!(b.label && !b.fallback) || (noun && len(topic) <= 60),
      };
    }
    case 'offer': {
      const lead = b.deadline ? `Jen ${b.deadline}` : t('Tohle si nenech ujít', 'Tohle si nenechte ujít');
      const hook = sentence(`${lead}: ${lcTopic}`);
      return {
        hook,
        short: compact(topic, 45),
        kicker: b.deadline ? `Jen ${b.deadline}`.slice(0, 30).toLocaleUpperCase('cs') : b.offer ? 'NABÍDKA' : t('NENECH SI UJÍT', 'NENECHTE SI UJÍT'),
        cta: v.b2b
          ? 'Napište si o nabídku, připravíme ji na míru.'
          : b.offer || b.deadline
            ? t('Zastav se, dokud to platí.', 'Zastavte se, dokud nabídka platí.')
            : t('Přijď, rádi tě uvidíme.', 'Přijďte, rádi vás uvidíme.'),
        ctaShort: b.deadline ? `Platí ${b.deadline}`.slice(0, 40) : v.b2b ? 'Napište si o nabídku' : t('Nenech si to ujít', 'Nenechte si to ujít'),
        why: b.deadline || b.offer
          ? 'Jasná nabídka s konkrétním důvodem dává lidem důvod jednat hned, ne „někdy“.'
          : 'Přímá pozvánka bez okolků – hodí se, když má post přivést lidi.',
        hookHasTopic: true,
      };
    }
    case 'proof': {
      const np = b.numberPoint;
      const hook = b.quote
        ? `„${shorten(b.quote, 110)}“`
        : np && np !== topic
          ? `${sentence(topic)} ${sentence(np)}`
          : sentence(topic);
      return {
        hook,
        short: compact(b.quote ?? np ?? topic, 45),
        kicker: b.quote ? 'ŘEKLI O NÁS' : b.testimonial ? 'PŘÍBĚH' : 'V ČÍSLECH',
        cta: v.b2b
          ? 'Chcete podobný výsledek? Napište nám, probereme váš projekt.'
          : t('Máš vlastní zkušenost? Podělíš se v komentářích?', 'Máte vlastní zkušenost? Budeme rádi, když se podělíte v komentářích.'),
        ctaShort: v.b2b ? 'Probereme váš projekt' : t('Vyzkoušej to', 'Vyzkoušejte to'),
        why: b.quote ? 'Slova zákazníka přesvědčí víc než cokoli, co o sobě řekne značka.' : 'Konkrétní čísla mluví sama za sebe a přesvědčí víc než přívlastky.',
        hookHasTopic: !b.quote,
      };
    }
  }
}

function pickTemplate(angle: ConceptAngle, b: Brief, format: PostFormat): TemplateId {
  if (b.photo) return format === 'carousel' ? 'split' : 'photo';
  if (angle === 'offer') return 'bold';
  if (angle === 'proof') return b.quote ? 'quote' : 'bold';
  if (angle === 'tip') return format === 'carousel' ? 'list' : 'minimal';
  if (angle === 'story') return 'editorial';
  if (angle === 'question') return 'gradient';
  return isVideoFormat(format) ? 'gradient' : format === 'carousel' ? 'editorial' : 'minimal';
}

// ---------- Návrh vizuálu ----------

function buildDesign(angle: ConceptAngle, c: Copy, b: Brief, v: Voice, req: ConceptsRequest): DesignSpec {
  const { format } = req;
  const points = b.points.slice(0, 5);
  const aspect = isVideoFormat(format) ? '9:16' : req.networks.includes('instagram') ? '4:5' : '1:1';
  const seed = seedFrom(`${req.brand.id}|${req.brief}|${angle}|${format}`);
  const headlineFor: Record<ConceptAngle, string> = {
    benefit: compact(b.topic, 70),
    story: compact(b.topic, 70),
    question: compact(c.hook.split(/(?<=\?)\s/)[0] ?? c.hook, 70),
    tip: c.short,
    offer: compact(b.topic, 70),
    // karusel: titulní slide nese téma, čísla jsou v obsahu; grafika/reel: číslo jako titulek
    proof: b.quote ? `„${shorten(b.quote, 86)}“` : compact(format === 'carousel' ? b.topic : b.numberPoint ?? b.topic, 70),
  };
  const slidesFor = (): DesignSlide[] => {
    if (format === 'image') {
      const body =
        angle === 'tip' ? tipItems(b).slice(0, 2).map(sentence).join(' ')
        : angle === 'question' && !c.hookHasTopic ? sentence(b.topic)
        : angle === 'proof' && c.hook !== sentence(b.topic) ? sentence(b.topic)
        : (bestPoint(b) && sentence(bestPoint(b)!)) || (b.fallback ? '' : sentence(points[0] ?? ''));
      return [{ kicker: c.kicker, headline: headlineFor[angle], body: shorten(body, 160) }];
    }
    if (format === 'carousel') {
      const steps = /^jak\s/iu.test(b.topic) || /krok|postup/iu.test(req.brief);
      const items = angle === 'tip' ? tipItems(b).slice(0, 5) : points;
      const content = items.map((p, i) => {
        if (b.fallback && b.listCount) {
          const [lab, rest] = p.split(': ');
          return { kicker: lab!.toLocaleUpperCase('cs'), headline: rest ?? p };
        }
        const head = compact(p, 70);
        const rest = head === stripEnd(p) ? '' : p.slice(head.length).replace(/^[,:\s–-]+/u, '');
        const slide: DesignSlide = {
          kicker: angle === 'tip' ? `${steps ? 'KROK' : 'TIP'} ${i + 1}` : String(i + 1).padStart(2, '0'),
          headline: capFirst(head),
        };
        if (rest) slide.body = shorten(capFirst(rest), 160);
        return slide;
      });
      return [
        { kicker: c.kicker, headline: headlineFor[angle], body: v.t('Listuj dál →', 'Listujte dál →') },
        ...content,
        ctaSlide(c, v, req.brand),
      ];
    }
    // reel / story: krátké texty na obrazovku, popisek je zvlášť
    const scenes: DesignSlide[] = [{ kicker: c.kicker, headline: c.short }];
    const first = c.short.toLocaleLowerCase('cs');
    const cands = [b.topic, ...points]
      .map((x) => capFirst(compact(x, 56)))
      .filter((x) => { const l = x.toLocaleLowerCase('cs'); return !l.startsWith(first.replace(/\?$/, '')) && !first.startsWith(l); });
    for (const x of [...new Set(cands)].slice(0, 3)) scenes.push({ headline: x });
    scenes.push({ headline: c.ctaShort, body: req.brand.name });
    return scenes;
  };
  const slides = slidesFor().map((s) => {
    const out: DesignSlide = { headline: scrubBanned(s.headline, req.brand.profile.bannedWords) };
    if (s.kicker) out.kicker = scrubBanned(s.kicker, req.brand.profile.bannedWords);
    if (s.body) out.body = scrubBanned(s.body, req.brand.profile.bannedWords);
    return out;
  });
  const range = SLIDE_RANGE[format];
  return validDesign({
    format,
    templateId: pickTemplate(angle, b, format),
    aspect,
    slides: slides.slice(0, range.max),
    cta: c.ctaShort,
    durationSec: isVideoFormat(format) ? slides.length * 3 : undefined,
    music: null,
    seed,
  });
}

function ctaSlide(c: Copy, v: Voice, brand: Brand): DesignSlide {
  const [first, ...rest] = c.cta.split(/(?<=[.?!])\s+|,\s+a\s+/u);
  const headline = first && len(first) <= 70 ? sentence(first) : sentence(c.ctaShort);
  const body = rest.length ? rest.map((x) => sentence(capFirst(x))).join(' ') : brand.profile.website ?? brand.name;
  return { kicker: v.t('A TEĎ TY', 'A TEĎ VY'), headline, body };
}

// ---------- Popisky pro sítě ----------

function hashtagsFor(brand: Brand): string[] {
  const p = brand.profile;
  if (p.maxHashtags <= 0) return [];
  const tags = p.defaultHashtags.slice(0, p.maxHashtags);
  if (!tags.length) {
    const slug = brand.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (slug) tags.push(`#${slug}`);
  }
  return tags;
}

function captionsFor(angle: ConceptAngle, c: Copy, b: Brief, v: Voice, req: ConceptsRequest, design: DesignSpec, tags: string[]) {
  const { t } = v;
  const emo = (e: string) => (v.emoji === 'none' ? '' : ` ${e}`);
  const facts = b.fallback ? [] : (angle === 'tip' ? tipItems(b) : b.points).filter((p) => !c.hook.includes(stripEnd(p)));
  const lead = c.hookHasTopic ? [] : [sentence(b.topic)];
  const out: Partial<Record<Network, string>> = {};
  const block = (...parts: (string | false | null | undefined)[]) => parts.filter((x): x is string => !!x && !!x.trim()).join('\n\n');

  for (const n of req.networks) {
    if (n === 'instagram') {
      let middle: string;
      if (req.format === 'carousel') {
        const heads = design.slides.slice(1, -1).map((s) => `→ ${s.headline}`);
        middle = [t('V karuselu najdeš:', 'V karuselu najdete:'), ...heads].join('\n');
        if (lead.length) middle = `${lead[0]}\n\n${middle}`;
      } else {
        middle = [...lead, ...facts.slice(0, 2).map(sentence)].join('\n');
      }
      out.instagram = block(
        c.hook + emo(ANGLE_EMOJI[angle]),
        middle,
        c.cta + (v.emoji === 'many' ? ' 👇' : ''),
        tags.join(' '),
      );
    } else if (n === 'facebook') {
      const para = [...lead, ...facts.slice(0, 3).map(sentence)].join(' ');
      const linkLine = `${t('Podrobnosti najdeš na', 'Podrobnosti najdete na')} ${v.link}`;
      out.facebook = block(
        c.hook + emo(ANGLE_EMOJI[angle]),
        para,
        `${c.cta} ${linkLine}`,
        tags.slice(0, Math.min(2, tags.length)).join(' '),
      );
    } else if (n === 'linkedin') {
      const p2 = [...lead, ...facts.slice(0, 2).map(sentence)].join(' ');
      const rest = facts.slice(2);
      const p3 =
        angle === 'tip' && facts.length ? facts.slice(0, 5).map((f, i) => `${i + 1}. ${sentence(f)}`).join('\n')
        : angle === 'offer' ? `Podrobnosti a podmínky: ${v.link}`
        : angle === 'story' ? 'Tyhle detaily zákazník většinou nevidí, ale právě na nich stojí výsledek.'
        : angle === 'proof' ? 'Za výsledkem je konkrétní práce a lidé, kteří ji dělají pořádně.'
        : angle === 'question' ? (v.b2b ? 'Zajímá nás, jak to vidí ostatní v oboru.' : 'Zajímá nás, jak to vidíte vy.')
        : rest.length ? rest.map(sentence).join(' ') : `Víc informací: ${v.link}`;
      const cta = v.b2b ? 'Máte dotaz nebo podobný projekt? Napište nám do zpráv.' : c.cta;
      out.linkedin = block(
        c.hook + (v.emoji === 'many' ? ` ${ANGLE_EMOJI[angle]}` : ''),
        angle === 'tip' ? [...lead].join(' ') : p2,
        p3,
        cta,
        tags.join(' '),
      );
    }
  }
  const banned = req.brand.profile.bannedWords;
  for (const k of Object.keys(out) as Network[]) {
    let txt = scrubBanned(out[k]!, banned);
    if (v.emoji === 'none') txt = txt.replace(EMOJI_RE, '').replace(/ +\n/g, '\n').replace(/ {2,}/g, ' ').trim();
    out[k] = txt;
  }
  return out;
}

// ---------- Veřejné API generátoru ----------

/** Deterministické koncepty z briefu (bez AI). */
export function templateConcepts(req: ConceptsRequest): Concept[] {
  const p = req.brand.profile;
  const v = voiceOf(req.brand);
  const b = analyze(req.brief, p.audience);
  const ctx = cleanBrief(req.brief);
  const angles = rankAngles(b, req.format).slice(0, Math.max(1, Math.min(req.count, MAX_CONCEPTS)));
  const tags = hashtagsFor(req.brand);
  return angles.map((angle) => {
    const c = copyFor(angle, b, v, req.format, ctx);
    c.hook = scrubBanned(c.hook, p.bannedWords);
    const design = buildDesign(angle, c, b, v, req);
    const captions = captionsFor(angle, c, b, v, req, design, tags);
    return {
      angle: ANGLE_LABELS[angle],
      hook: c.hook,
      design,
      captions,
      hashtags: tags,
      hookScore: hookScore(c.hook, p),
      why: c.why,
    };
  });
}

/**
 * Převede volně strukturovaný koncept (např. od LLM) na platný Concept: návrh projde validDesign,
 * popisky jen pro požadované sítě, hashtagy podle značky, hookScore se přepočítá heuristikou.
 * Vrací null, pokud koncept nejde zachránit.
 */
export function coerceConcept(raw: unknown, req: Pick<ConceptsRequest, 'brand' | 'format' | 'networks' | 'brief'>, index = 0): Concept | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const hook = typeof r.hook === 'string' ? r.hook.trim() : '';
  if (!hook) return null;
  const p = req.brand.profile;
  const d = (r.design && typeof r.design === 'object' ? r.design : r) as Record<string, unknown>;
  const templateId = TEMPLATE_IDS.includes(d.templateId as TemplateId) ? d.templateId : 'editorial';
  let design: DesignSpec;
  try {
    design = validDesign({
      format: req.format,
      templateId,
      aspect: isVideoFormat(req.format) ? '9:16' : req.networks.includes('instagram') ? '4:5' : '1:1',
      slides: Array.isArray(d.slides) ? d.slides.slice(0, SLIDE_RANGE[req.format].max) : [],
      cta: d.cta,
      durationSec: d.durationSec,
      music: null,
      seed: seedFrom(`${req.brand.id}|${req.brief}|${index}|${hook}`),
    });
  } catch {
    return null;
  }
  const rawCaps = (r.captions && typeof r.captions === 'object' ? r.captions : {}) as Record<string, unknown>;
  const captions: Partial<Record<Network, string>> = {};
  for (const n of req.networks) {
    const c = rawCaps[n];
    if (typeof c === 'string' && c.trim()) captions[n] = c.trim();
  }
  if (!Object.keys(captions).length) return null;
  const tags = (Array.isArray(r.hashtags) ? r.hashtags : [])
    .map((h) => String(h).trim().replace(/\s+/g, ''))
    .filter(Boolean)
    .map((h) => (h.startsWith('#') ? h : `#${h}`))
    .slice(0, p.maxHashtags);
  return {
    angle: typeof r.angle === 'string' && r.angle.trim() ? r.angle.trim().slice(0, 40) : 'Varianta',
    hook: hook.slice(0, 300),
    design,
    captions,
    hashtags: tags,
    hookScore: hookScore(hook, p),
    why: typeof r.why === 'string' ? r.why.trim().slice(0, 300) : '',
  };
}

// ---------- Měsíční plán ----------

export const PLAN_TIMES = ['07:30', '11:30', '17:30', '19:00'] as const;

/** Posun Europe/Prague proti UTC v minutách pro daný okamžik (zvládne letní čas). */
function pragueOffsetMin(utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Prague', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const g = (type: string) => Number(parts.find((x) => x.type === type)?.value ?? 0);
  return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - utcMs) / 60000;
}

/** Místní čas v Praze → ISO v UTC. */
export function pragueToIso(y: number, m: number, d: number, hh: number, mm: number): string {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ts = guess - pragueOffsetMin(guess) * 60000;
  const second = guess - pragueOffsetMin(ts) * 60000;
  if (second !== ts) ts = second;
  return new Date(ts).toISOString();
}

/** Dny v týdnu (0 = neděle) podle počtu postů týdně. */
const WEEK_PATTERN: Record<number, number[]> = {
  1: [3],
  2: [2, 4],
  3: [1, 3, 5],
  4: [1, 3, 5, 6],
  5: [1, 2, 3, 4, 5],
  6: [1, 2, 3, 4, 5, 6],
  7: [0, 1, 2, 3, 4, 5, 6],
};

/** 40 % grafika, 30 % karusel, 30 % reel, promíchané, ať se formáty nestřídají mechanicky. */
const DEFAULT_MIX: PostFormat[] = ['image', 'carousel', 'reel', 'image', 'reel', 'carousel', 'image', 'carousel', 'reel', 'image'];

export function derivePillars(profile: BrandProfile): string[] {
  if (profile.pillars.length) return profile.pillars;
  const t = `${profile.tone} ${profile.audience}`.toLocaleLowerCase('cs');
  if (/(vyk|odborn|investor|developer|firm|b2b|manažer)/u.test(t)) {
    return ['Reference a výsledky', 'Odborné rady', 'Tým a zákulisí', 'Novinky z oboru'];
  }
  if (/(rodin|děti|soused|okolí)/u.test(t)) return ['Produkty a novinky', 'Tipy a rady', 'Za oponou', 'Sousedé a komunita'];
  return ['Produkty a novinky', 'Tipy a rady', 'Za oponou', 'Komunita a zákazníci'];
}

function timeFor(format: PostFormat, i: number, dow: number): string {
  const weekend = dow === 0 || dow === 6;
  if (format === 'reel' || format === 'story') return '19:00';
  if (weekend) return '11:30';
  if (format === 'carousel') return i % 2 ? '17:30' : '11:30';
  return i % 2 ? '17:30' : '07:30';
}

/** Rozvrh plánu (termíny, pilíře, formáty) bez nápadů. Sdílí ho šablona i LLM adaptér. */
export function planSlots(req: PlanRequest): PlanSlot[] {
  const [y, m] = req.month.split('-').map(Number) as [number, number];
  const perWeek = Math.min(Math.max(Math.round(req.postsPerWeek), 1), 7);
  const days = WEEK_PATTERN[perWeek]!;
  const pillars = derivePillars(req.brand.profile);
  const formats = req.formats?.length ? req.formats.filter((f) => POST_FORMATS.includes(f)) : null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: PlanSlot[] = [];
  let i = 0;
  for (let d = 1; d <= last; d++) {
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (!days.includes(dow)) continue;
    const format = formats ? formats[i % formats.length]! : DEFAULT_MIX[i % DEFAULT_MIX.length]!;
    const [hh, mm] = timeFor(format, i, dow).split(':').map(Number) as [number, number];
    const date = pragueToIso(y, m, d, hh, mm);
    if (date <= req.now) continue;
    out.push({ date, pillar: pillars[i % pillars.length]!, format });
    i++;
  }
  return out;
}

const MONTH_ACC = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
const MONTH_LOC = ['v lednu', 'v únoru', 'v březnu', 'v dubnu', 'v květnu', 'v červnu', 'v červenci', 'v srpnu', 'v září', 'v říjnu', 'v listopadu', 'v prosinci'];

type PillarKind = 'tip' | 'story' | 'product' | 'proof' | 'community' | 'seasonal';

function kindOf(pillar: string): PillarKind {
  const p = pillar.toLocaleLowerCase('cs');
  if (/(referenc|realizac|výsled|recenz|zákazník|člen|klient|příběh)/u.test(p)) return 'proof';
  if (/(tip|rad[ayi]|know|jak |návod|vzděl|eduk|technolog|postup|trénink|cvičen)/u.test(p)) return 'tip';
  if (/(sezón|svát|vánoc|velikono|léto|podzim|zim|jaro)/u.test(p)) return 'seasonal';
  if (/(oponou|zákulis|tým|lidé|lidi|řemesl|výrob|kvas|firma|bezpečn)/u.test(p)) return 'story';
  if (/(komunit|soused|akce|event|místn|lokál|rodin)/u.test(p)) return 'community';
  return 'product';
}

const IDEAS: Record<PillarKind, { text: (acc: string, loc: string) => string; formats: PostFormat[] }[]> = {
  tip: [
    { text: () => '5 nejčastějších chyb a jak se jim vyhnout', formats: ['carousel'] },
    { text: () => 'jedna rada, kterou zvládnete hned dnes', formats: ['image', 'story'] },
    { text: () => 'rychlý tip na 15 vteřin', formats: ['reel', 'story'] },
    { text: () => '3 kroky pro úplné začátečníky', formats: ['carousel'] },
    { text: () => 'mýtus, nebo pravda?', formats: ['image', 'reel'] },
    { text: () => 'na co se nás lidé ptají nejčastěji', formats: ['reel', 'carousel'] },
  ],
  story: [
    { text: () => 'jeden den v zákulisí krok za krokem', formats: ['reel', 'story'] },
    { text: () => 'představujeme člověka, který za tím stojí', formats: ['image'] },
    { text: () => 'co všechno je potřeba, než je hotovo', formats: ['carousel'] },
    { text: () => 'detail, kterého si běžně nikdo nevšimne', formats: ['reel', 'image'] },
    { text: (_a, loc) => `co jsme ${loc} udělali poprvé`, formats: ['image', 'carousel'] },
  ],
  product: [
    { text: (_a, loc) => `co nového přinášíme ${loc}`, formats: ['image'] },
    { text: () => '3 důvody, proč si to vybrat', formats: ['carousel'] },
    { text: () => 'jak to vzniká od začátku do konce', formats: ['reel'] },
    { text: () => 'co se hodí pro koho – rychlé srovnání', formats: ['carousel'] },
    { text: () => 'jedna věc, na kterou jsme opravdu pyšní', formats: ['image', 'reel'] },
  ],
  proof: [
    { text: () => 'příběh jednoho zákazníka', formats: ['carousel', 'reel'] },
    { text: () => 'výsledek v číslech', formats: ['image'] },
    { text: () => 'před a po', formats: ['reel', 'carousel'] },
    { text: () => 'co o nás říkají ti, kdo to zažili', formats: ['image'] },
  ],
  community: [
    { text: (acc) => `co chystáme na ${acc}`, formats: ['image', 'reel'] },
    { text: () => 'poděkování lidem, kteří jsou s námi', formats: ['image', 'carousel'] },
    { text: () => 'otázka pro sledující – rozhodněte s námi', formats: ['image', 'story'] },
    { text: () => 'místa a lidé z okolí, které máme rádi', formats: ['carousel', 'reel'] },
  ],
  seasonal: [
    { text: (_a, loc) => `na co se těšit ${loc}`, formats: ['image', 'carousel'] },
    { text: (acc) => `sezónní tip na ${acc}`, formats: ['reel', 'image'] },
    { text: (acc) => `jak si užít ${acc} naplno`, formats: ['carousel'] },
  ],
};

/** Deterministický měsíční plán s konkrétními nápady. */
export function templatePlan(req: PlanRequest): PlanItem[] {
  const m = Number(req.month.split('-')[1]) - 1;
  const used = new Map<string, Set<number>>();
  return planSlots(req).map((slot) => {
    const kind = kindOf(slot.pillar);
    const list = IDEAS[kind];
    const key = `${slot.pillar}`;
    const seen = used.get(key) ?? new Set<number>();
    if (seen.size >= list.length) seen.clear();
    let idx = list.findIndex((x, i) => !seen.has(i) && x.formats.includes(slot.format));
    if (idx < 0) idx = list.findIndex((_x, i) => !seen.has(i));
    seen.add(idx);
    used.set(key, seen);
    return { ...slot, idea: `${slot.pillar}: ${list[idx]!.text(MONTH_ACC[m]!, MONTH_LOC[m]!)}` };
  });
}

