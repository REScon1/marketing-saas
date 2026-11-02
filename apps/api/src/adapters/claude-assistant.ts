import Anthropic from '@anthropic-ai/sdk';
import {
  buildDraftPrompt, buildRewritePrompt, DomainError,
  type Brand, type ContentAssistant, type DraftRequest, type DraftVariant, type Language, type ReportSummaryInput,
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
  const cleaned = stripCodeFences(text);
  let data: unknown = tryParse(cleaned);
  if (data === undefined) {
    // Text okolo JSONu: vezmi první objekt / pole.
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (start >= 0 && end > start) data = tryParse(cleaned.slice(start, end + 1));
  }
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

  private async complete(system: string, user: string, maxTokens: number): Promise<string> {
    const msg = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    });
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

  async summarizeReport(input: ReportSummaryInput, language: Language = 'cs'): Promise<string> {
    const { system, user } = buildSummaryPrompt(input, language);
    const out = (await this.complete(system, user, 600)).trim();
    if (!out) throw new Error('Prázdné shrnutí od AI');
    return out;
  }
}
