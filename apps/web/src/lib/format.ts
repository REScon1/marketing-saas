import type { Network, PostStatus } from '@ms/core';

export const TZ = 'Europe/Prague';

export const fmtDateTime = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
    : '—';

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(iso)) : '—';

export const fmtDayShort = (iso: string) =>
  new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'numeric' }).format(new Date(iso));

export const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

export const fmtNum = (n: number) => Math.round(n).toLocaleString('cs-CZ');
export const fmtPct = (x: number) => `${(x * 100).toLocaleString('cs-CZ', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`;

export function relative(iso: string): string {
  const d = (Date.parse(iso) - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('cs', { numeric: 'auto' });
  const abs = Math.abs(d);
  if (abs < 60) return 'právě teď';
  if (abs < 3600) return rtf.format(Math.round(d / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(d / 3600), 'hour');
  return rtf.format(Math.round(d / 86400), 'day');
}

/** Datum v Praze jako YYYY-MM-DD. */
export function pragueDay(iso: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return p;
}

/** Hodnota pro <input type="datetime-local"> v pražském čase. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

/** Z <input type="datetime-local"> (pražský čas) na ISO UTC. */
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const guess = Date.parse(`${v}:00Z`);
  // posun Prahy vůči UTC v daném okamžiku
  const offsetMin = (() => {
    const s = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' }).format(new Date(guess));
    const m = /GMT([+-]\d+)(?::(\d+))?/.exec(s);
    return m ? Number(m[1]) * 60 + Math.sign(Number(m[1])) * Number(m[2] ?? 0) : 0;
  })();
  return new Date(guess - offsetMin * 60000).toISOString();
}

export const STATUS_LABEL: Record<PostStatus, string> = {
  draft: 'Koncept',
  in_review: 'Čeká na klienta',
  changes_requested: 'K úpravě',
  approved: 'Schváleno',
  scheduled: 'Naplánováno',
  publishing: 'Publikuje se',
  published: 'Publikováno',
  failed: 'Chyba publikace',
};

export const NETWORK_LABEL: Record<Network, string> = { facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn' };

export const ROLE_LABEL = { owner: 'Majitel', manager: 'Manažer', client: 'Klient' } as const;

export function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: string }).message);
  return 'Něco se pokazilo';
}
