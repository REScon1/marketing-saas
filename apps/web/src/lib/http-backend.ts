import { DomainError, type Agency, type Backend, type Role, type User } from '@ms/core';

export interface Me {
  user: User;
  agencies: { agency: Agency; role: Role; clientId: string | null }[];
}

async function post<T>(url: string, body: unknown, agencyId?: string): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(agencyId ? { 'x-agency-id': agencyId } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json?.error;
    throw new DomainError(e?.code ?? 'invalid', e?.message ?? `Chyba serveru (${res.status})`, e?.details ?? {});
  }
  return json.result ?? json;
}

export class HttpBackend implements Backend {
  agencyId: string | null = null;

  async me(): Promise<Me | null> {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (res.status === 401) return null;
    if (!res.ok) throw new Error('Server není dostupný');
    const json = await res.json();
    return (json.result ?? json) as Me;
  }

  login(email: string, password: string) {
    return post<Me>('/api/auth/login', { email, password });
  }

  logout() {
    return post('/api/auth/logout', {});
  }

  call: Backend['call'] = (method, ...args) => post(`/api/rpc/${method}`, { args }, this.agencyId ?? undefined) as never;
  callPublic: Backend['callPublic'] = (method, ...args) => post(`/api/public/${method}`, { args }) as never;
}
