import Anthropic from '@anthropic-ai/sdk';
import {
  buildConceptsPrompt, buildDraftPrompt, buildPlanPrompt, buildRewritePrompt, coerceConcept, DomainError, planSlots, templatePlan,
  TEMPLATE_IDS,
  type Brand, type Concept, type ConceptsRequest, type ContentAssistant, type DraftRequest, type DraftVariant, type Language, type Network,
  type PlanItem, type PlanRequest, type PlanSlot, type ReportSummaryInput,
} from '@ms/core';

/** Minimální podmnožina klienta, kterou potřebujeme (v testech se dá podvrhnout). */
export interface MessagesClient {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

const PARSE_ERROR = 'AI asistent vrátil odpověď v neočekávaném formátu. Zkuste to prosím znovu.';

/** Odstraní ```json … ``` obal, pokud ho model přidal. */
export function stripCodeFences(text: string): string {
  const t = text.trim();
  const m = /^```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?```$/.exec(t);
  return (m ? m[1]! : t).trim();
}

/**
 * Robustní parsování variant z odpovědi modelu. Přijme {"variants":[…]}, holé pole,
 * obal v code fence i text okolo JSONu. Při chybě vyhodí DomainError 'invalid' s českou zprávou.
 */
export function parseDraftVariants(text: string, max = 3): DraftVariant[] {
  const data = extractJson(text);
  const list = Array.isArray(data) ? data : (data as { variants?: unknown } | undefined)?.variants;
  if (!Array.isArray(list)) throw new DomainError('invalid', PARSE_ERROR);
  const out: DraftVariant[] = [];
  for (const v of list) {
    if (!v || typeof v !== 'object') continue;
    const body = (v as { body?: unknown }).body;
    const angle = (v as { angle?: unknown }).angle;
    if (typeof body !== 'string' || !body.trim()) continue;
    out.push({ body: body.trim(), angle: typeof angle === 'string' && angle.trim() ? angle.trim() : 'Varianta' });
  }
  if (!out.length) throw new DomainError('invalid', PARSE_ERROR);
  return out.slice(0, Math.max(1, max));
}

/** JSON z odpovědi modelu: snese code fence i text okolo (vezme první objekt / pole). */
export function extractJson(text: string): unknown {
  const cleaned = stripCodeFences(text);
  let data: unknown = tryParse(cleaned);
  if (data === undefined) {
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (start >= 0 && end > start) data = tryParse(cleaned.slice(start, end + 1));
  }
  return data;
}

/**
 * Koncepty z odpovědi modelu. Každý projde coerceConcept (validDesign, jen požadované sítě,
 * hookScore přepočítaný heuristikou); nevalidní se zahodí. Když neprojde žádný, vyhodí DomainError.
 */
export function parseConcepts(text: string, req: Pick<ConceptsRequest, 'brand' | 'format' | 'networks' | 'brief' | 'count'>): Concept[] {
  const data = extractJson(text);
  const list = Array.isArray(data) ? data : (data as { concepts?: unknown } | undefined)?.concepts;
  if (!Array.isArray(list)) throw new DomainError('invalid', PARSE_ERROR);
  const out = list.map((c, i) => coerceConcept(c, req, i)).filter((c): c is Concept => !!c);
  if (!out.length) throw new DomainError('invalid', PARSE_ERROR);
  return out.slice(0, Math.max(1, req.count));
}

/** Nápady k rozvrhu plánu. Chybějící nebo prázdné položky doplní deterministická šablona. */
export function parsePlanIdeas(text: string, slots: PlanSlot[], fallback: PlanItem[]): PlanItem[] {
  const data = extractJson(text);
  const list = Array.isArray(data) ? data : (data as { items?: unknown } | undefined)?.items;
  if (!Array.isArray(list)) throw new DomainError('invalid', PARSE_ERROR);
  const ideas = new Map<number, string>();
  for (const it of list) {
    const idx = Number((it as { index?: unknown })?.index);
    const idea = (it as { idea?: unknown })?.idea;
    if (Number.isInteger(idx) && idx >= 0 && idx < slots.length && typeof idea === 'string' && idea.trim()) ideas.set(idx, idea.trim().slice(0, 200));
  }
  if (!ideas.size) throw new DomainError('invalid', PARSE_ERROR);
  return slots.map((s, i) => ({ ...s, idea: ideas.get(i) ?? fallback[i]?.idea ?? s.pillar }));
}

/** JSON schéma pro structured outputs (konceptů). Formát, poměr stran a seed doplní kód. */
export function conceptsSchema(networks: Network[]) {
  const str = { type: 'string' };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['concepts'],
    properties: {
      concepts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['angle', 'hook', 'templateId', 'slides', 'captions', 'hashtags', 'why'],
          properties: {
            angle: str,
            hook: str,
            templateId: { type: 'string', enum: [...TEMPLATE_IDS] },
            slides: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: false, required: ['headline'],
                properties: { kicker: str, headline: str, body: str },
              },
            },
            cta: str,
            durationSec: { type: 'integer' },
            captions: {
              type: 'object', additionalProperties: false, required: [...networks],
              properties: Object.fromEntries(networks.map((n) => [n, str])),
            },
            hashtags: { type: 'array', items: str },
            why: str,
          },
        },
      },
    },
  };
}

export const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['index', 'idea'],
        properties: { index: { type: 'integer' }, idea: { type: 'string' } },
      },
    },
  },
};

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function textOf(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

const LANG: Record<Language, string> = { cs: 'češtině', sk: 'slovenštině', en: 'angličtině' };

/** Vstup pro shrnutí reportu: čísla předformátovaná, aby je model jen převzal. */
export function buildSummaryPrompt(r: ReportSummaryInput, language: Language) {
  const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')} %`;
  const facts: string[] = [
    `Značka: ${r.brandName}`,
    `Období: ${r.periodLabel}`,
    `Počet publikovaných postů: ${r.posts}`,
    `Dosah: ${r.reach}`,
    `Interakce: ${r.engagements}`,
    `Míra zapojení: ${pct(r.engagementRate)}`,
  ];
  if (r.previous) {
    facts.push(`Předchozí měsíc – dosah: ${r.previous.reach}, interakce: ${r.previous.engagements}, míra zapojení: ${pct(r.previous.engagementRate)}`);
  } else {
    facts.push('Předchozí měsíc: bez dat');
  }
  if (r.topPostTitle) facts.push(`Nejúspěšnější post: „${r.topPostTitle}“`);
  if (r.bestNetwork) facts.push(`Nejsilnější síť: ${r.bestNetwork}`);
  return {
    system: [
      'Jsi analytik marketingové agentury a píšeš shrnutí měsíčního reportu pro klienta.',
      'Používej VÝHRADNĚ čísla a fakta z podkladů. Žádná čísla nevymýšlej, nepočítej nové metriky a neodhaduj příčiny, které z podkladů neplynou.',
      'Pokud podklad chybí, nezmiňuj ho.',
    ].join(' '),
    user: [
      `Podklady:\n<podklady>\n${facts.join('\n')}\n</podklady>`,
      '',
      `Napiš krátký odstavec (2–4 věty) v ${LANG[language]}. Bez nadpisu, bez odrážek, bez emoji. Odpověz jen samotným odstavcem.`,
    ].join('\n'),
  };
}

export class ClaudeAssistant implements ContentAssistant {
  readonly label: string;
  readonly isAi = true;
  private readonly model: string;
  private readonly client: MessagesClient;

  constructor(opts: { apiKey?: string; model: string; client?: MessagesClient }) {
    this.model = opts.model;
    this.label = `Claude (${opts.model})`;
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey, timeout: 60_000, maxRetries: 2 });
  }

  private async complete(system: string, user: string, maxTokens: number, schema?: Record<string, unknown>): Promise<string> {
    const msg = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
      ...(schema ? { output_config: { format: { type: 'json_schema' as const, schema } } } : {}),
    });
    if (msg.stop_reason === 'refusal') {
      throw new DomainError('invalid', 'AI asistent tento požadavek odmítl zpracovat. Upravte prosím brief.');
    }
    return textOf(msg);
  }

  async draft(req: DraftRequest): Promise<DraftVariant[]> {
    const { system, user } = buildDraftPrompt(req);
    return parseDraftVariants(await this.complete(system, user, 4000), req.variants);
  }

  async rewrite(req: { brand: Brand; body: string; instruction: string; language: Language }): Promise<string> {
    const { system, user } = buildRewritePrompt(req);
    const out = stripCodeFences(await this.complete(system, user, 3000))
      .replace(/^<text>\s*/i, '')
      .replace(/\s*<\/text>$/i, '')
      .trim();
    if (!out) throw new DomainError('invalid', PARSE_ERROR);
    return out;
  }

  async concepts(req: ConceptsRequest): Promise<Concept[]> {
    const { system, user } = buildConceptsPrompt(req);
    return parseConcepts(await this.complete(system, user, 16000, conceptsSchema(req.networks)), req);
  }

  /** Termíny, pilíře a formáty počítá kód (planSlots); model jen vymýšlí nápady. */
  async planMonth(req: PlanRequest): Promise<PlanItem[]> {
    const slots = planSlots(req);
    if (!slots.length) return [];
    const { system, user } = buildPlanPrompt(req, slots);
    return parsePlanIdeas(await this.complete(system, user, 8000, PLAN_SCHEMA), slots, templatePlan(req));
  }

  async summarizeReport(input: ReportSummaryInput, language: Language = 'cs'): Promise<string> {
    const { system, user } = buildSummaryPrompt(input, language);
    const out = (await this.complete(system, user, 600)).trim();
    if (!out) throw new Error('Prázdné shrnutí od AI');
    return out;
  }
}
