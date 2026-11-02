import type { Backend, Role } from '@ms/core';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DemoBackend } from './demo-backend';
import { errorMessage } from './format';
import type { HttpBackend } from './http-backend';

export interface SessionActor {
  userId: string;
  name: string;
  email: string;
  role: Role;
  clientId: string | null;
  agencyId: string;
}

export interface Session {
  backend: Backend;
  actor: SessionActor;
  agencyName: string;
  demo: DemoBackend | null;
  http: HttpBackend | null;
  logout(): void;
}

const SessionCtx = createContext<Session | null>(null);
const RefreshCtx = createContext<{ version: number; bump(): void }>({ version: 0, bump: () => {} });
const ToastCtx = createContext<(msg: string, kind?: 'ok' | 'error') => void>(() => {});

export function useSession(): Session {
  const s = useContext(SessionCtx);
  if (!s) throw new Error('Session chybí');
  return s;
}

export const useApi = () => useSession().backend;
export const useRefresh = () => useContext(RefreshCtx).bump;
export const useToast = () => useContext(ToastCtx);
export const isStaffRole = (r: Role) => r === 'owner' || r === 'manager';

export function SessionProvider({ session, children }: { session: Session; children: ReactNode }) {
  return <SessionCtx.Provider value={session}>{children}</SessionCtx.Provider>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: 'ok' | 'error' }[]>([]);
  const nextId = useRef(1);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const toast = useCallback((msg: string, kind: 'ok' | 'error' = 'ok') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  return (
    <RefreshCtx.Provider value={{ version, bump }}>
      <ToastCtx.Provider value={toast}>
        {children}
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>{t.msg}</div>
          ))}
        </div>
      </ToastCtx.Provider>
    </RefreshCtx.Provider>
  );
}

/** Načte data a znovu je načte po každém `bump()` (po mutaci kdekoli v aplikaci). */
export function useData<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: string | null; loading: boolean; reload(): void } {
  const { version } = useContext(RefreshCtx);
  const [state, setState] = useState<{ data: T | undefined; error: string | null; loading: boolean }>({ data: undefined, error: null, loading: true });
  const [local, setLocal] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fn().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (e) => alive && setState({ data: undefined, error: errorMessage(e), loading: false }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version, local]);
  return { ...state, reload: () => setLocal((x) => x + 1) };
}

/** Obal mutace: zobrazí chybu jako toast, po úspěchu obnoví data. */
export function useAction() {
  const toast = useToast();
  const bump = useRefresh();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (okMsg) toast(okMsg);
        bump();
        return r;
      } catch (e) {
        toast(errorMessage(e), 'error');
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast, bump],
  );
  return { run, busy };
}
