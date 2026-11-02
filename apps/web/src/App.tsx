import type { Backend } from '@ms/core';
import {
  BarChart3, Bell, Briefcase, CalendarDays, CheckCircle2, ChevronsLeft, ChevronsRight, Layers, LayoutDashboard, LogOut, Moon, Plus, Sun, Users, Waves,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Ambient } from './components/Ambient';
import { Flip, gsap, pageOut, reduced, slidePill } from './lib/motion';
import { Avatar } from './components/ui';
import { AppProviders, BrandFilterProvider, SessionProvider, isStaffRole, useBrandFilter, useData, useSession, type Session, type SessionActor } from './lib/app';
import { DemoBackend } from './lib/demo-backend';
import { errorMessage, ROLE_LABEL } from './lib/format';
import { HttpBackend, type Me } from './lib/http-backend';
import { Approvals } from './pages/Approvals';
import { BrandPage } from './pages/BrandPage';
import { CalendarPage } from './pages/Calendar';
import { Clients } from './pages/Clients';
import { Dashboard } from './pages/Dashboard';
import { PostEditor } from './pages/PostEditor';
import { PublicApproval } from './pages/PublicApproval';
import { Reports } from './pages/Reports';
import { Team } from './pages/Team';

type Boot =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'demo'; demo: DemoBackend }
  | { kind: 'http'; http: HttpBackend; me: Me | null };

export function App() {
  const [boot, setBoot] = useState<Boot>({ kind: 'loading' });
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (__DEMO__) {
          setBoot({ kind: 'demo', demo: await DemoBackend.create() });
        } else {
          const http = new HttpBackend();
          setBoot({ kind: 'http', http, me: await http.me() });
        }
      } catch (e) {
        setBoot({ kind: 'error', message: errorMessage(e) });
      }
    })();
  }, []);

  // V demu běží „worker“ publikace přímo v prohlížeči.
  useEffect(() => {
    if (boot.kind !== 'demo') return;
    const t = setInterval(() => void boot.demo.tick(), 15000);
    return () => clearInterval(t);
  }, [boot]);

  if (boot.kind === 'loading') return <div className="login-wrap muted">Načítám…</div>;
  if (boot.kind === 'error') return <div className="login-wrap"><div className="alert error">{boot.message}</div></div>;

  const backend: Backend = boot.kind === 'demo' ? boot.demo : boot.http;

  return (
    <AppProviders>
      <HashRouter>
        <Routes>
          <Route path="/schvalit/:token" element={<PublicApproval backend={backend} />} />
          <Route
            path="*"
            element={
              session ? (
                <SessionProvider session={session}>
                  <Shell />
                </SessionProvider>
              ) : (
                <Login boot={boot} onSession={setSession} />
              )
            }
          />
        </Routes>
      </HashRouter>
    </AppProviders>
  );
}

function Login({ boot, onSession }: { boot: Extract<Boot, { kind: 'demo' | 'http' }>; onSession(s: Session): void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const logout = () => onSession(null as unknown as Session);

  async function enterDemo(userId: string, email: string) {
    if (boot.kind !== 'demo') return;
    const a = await boot.demo.login(userId);
    onSession({
      backend: boot.demo, demo: boot.demo, http: null, agencyName: 'Studio Dobrý Den', logout,
      actor: { ...a, email },
    });
  }

  async function enterHttp(me: Me) {
    if (boot.kind !== 'http') return;
    const first = me.agencies[0];
    if (!first) throw new Error('Nejste členem žádné agentury');
    boot.http.agencyId = first.agency.id;
    const actor: SessionActor = {
      userId: me.user.id, name: me.user.name, email: me.user.email, role: first.role, clientId: first.clientId, agencyId: first.agency.id,
    };
    onSession({
      backend: boot.http, demo: null, http: boot.http, agencyName: first.agency.name, actor,
      logout: () => void boot.http.logout().then(logout),
    });
  }

  useEffect(() => {
    if (boot.kind === 'http' && boot.me) void enterHttp(boot.me).catch((e) => setError(errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="login-wrap">
      <div className="login stack">
        <div className="logo"><span className="logo-mark"><Waves size={20} /></span>Postovna</div>
        {boot.kind === 'demo' ? (
          <div className="card card-pad stack">
            <h1>Vyzkoušejte demo</h1>
            <p className="muted">
              Vše běží ve vašem prohlížeči nad smyšlenými daty agentury Studio Dobrý Den. Nic se nikam neodesílá ani nepublikuje.
              Vyberte, za koho se chcete podívat:
            </p>
            {boot.demo.seed.personas.map((p) => (
              <button key={p.key} className="persona" onClick={() => void enterDemo(p.userId, p.email)}>
                <Avatar name={p.name} />
                <div>
                  <div className="strong">{p.name}</div>
                  <div className="small muted">{p.label}</div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <form
            className="card card-pad stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await enterHttp(await boot.http.login(email, password));
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <h1>Přihlášení</h1>
            {error && <div className="alert error">{error}</div>}
            <label className="field"><span>E-mail</span><input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <label className="field"><span>Heslo</span><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
            <button className="btn primary" disabled={busy}>Přihlásit se</button>
          </form>
        )}
      </div>
    </div>
  );
}

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(() => {
    try {
      return (localStorage.getItem('ms-theme') as 'light' | 'dark' | null) ?? null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    try {
      if (theme) localStorage.setItem('ms-theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  const dark = theme ? theme === 'dark' : window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return { dark, toggle: () => setTheme(dark ? 'light' : 'dark') };
}


function Shell() {
  const s = useSession();
  return (
    <BrandFilterProvider>
      <ShellInner />
    </BrandFilterProvider>
  );
}

function ShellInner() {
  const s = useSession();
  const { actor } = s;
  const staff = isStaffRole(actor.role);
  const theme = useTheme();
  const navigate = useNavigate();
  const loc = useLocation();
  const { brandId, setBrandId } = useBrandFilter();
  const [confirmReset, setConfirmReset] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const brands = useData(() => s.backend.call('catalog.listBrands'), []);
  const pending = useData(() => s.backend.call('content.pendingApprovals'), []);
  const attention = useData(() => (staff ? s.backend.call('content.listPosts', { status: ['changes_requested', 'failed', 'approved'] }) : Promise.resolve([])), [staff]);
  const pendingCount = pending.data?.length ?? 0;
  const needsCount = staff ? (attention.data?.length ?? 0) + pendingCount : pendingCount;

  useEffect(() => {
    if (brandId && brands.data && !brands.data.some((b) => b.id === brandId)) setBrandId('');
  }, [brands.data, brandId, setBrandId]);

  // Přechod stránek: obsah se rozmaže a zmizí, pak se změní adresa; nová stránka naběhne přes useReveal.
  const go = useCallback((to: string) => {
    if (to === loc.pathname) return;
    pageOut(mainRef.current, () => {
      navigate(to);
      window.scrollTo(0, 0);
    });
  }, [loc.pathname, navigate]);

  useLayoutEffect(() => {
    // Stránky bez vlastního useReveal (nebo po přímé navigaci) musí být vždy vidět.
    const el = mainRef.current;
    if (el) gsap.set(el, { opacity: 1, filter: 'none', y: 0, scale: 1 });
  }, [loc.pathname]);

  const tabs: NavItem[] = staff
    ? [
        { to: '/', label: 'Přehled', end: true },
        { to: '/kalendar', label: 'Kalendář' },
        { to: '/schvalovani', label: 'Schvalování', count: pendingCount },
        { to: '/reporty', label: 'Reporty' },
        { to: '/klienti', label: 'Klienti a značky' },
      ]
    : [
        { to: '/', label: 'Ke schválení', end: true, count: pendingCount },
        { to: '/kalendar', label: 'Kalendář' },
        { to: '/reporty', label: 'Reporty' },
      ];

  const dock: NavItem[] = staff
    ? [
        { to: '/', label: 'Přehled', icon: LayoutDashboard, end: true },
        { to: '/kalendar', label: 'Kalendář', icon: CalendarDays },
        { to: '/schvalovani', label: 'Schvalování', icon: CheckCircle2 },
        { to: '/reporty', label: 'Reporty', icon: BarChart3 },
        { to: '/klienti', label: 'Klienti a značky', icon: Briefcase, hideMobile: true },
        ...(actor.role === 'owner' ? [{ to: '/tym', label: 'Tým', icon: Users, hideMobile: true }] : []),
      ]
    : [
        { to: '/', label: 'Ke schválení', icon: CheckCircle2, end: true },
        { to: '/kalendar', label: 'Kalendář', icon: CalendarDays },
        { to: '/reporty', label: 'Reporty', icon: BarChart3 },
      ];

  return (
    <div className="app">
      <Ambient />
      <Dock items={dock} staff={staff} go={go} theme={theme} onLogout={() => { navigate('/'); s.logout(); }} demo={!!s.demo} />

      <div className="main">
        <header className="topbar no-print">
          <div className="logo"><span className="logo-mark"><Waves size={20} /></span>Postovna</div>
          <PillTabs items={tabs} go={go} />
          <div className="spacer" />
          {(brands.data?.length ?? 0) > 1 && (
            <label className="pill-select">
              <span className="ico"><Layers size={14} /></span>
              <select id="brand-filter" value={brandId} onChange={(e) => setBrandId(e.target.value)} aria-label="Značka">
                <option value="">Všechny značky</option>
                {brands.data!.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          )}
          <button className="icon-btn" onClick={() => go('/')} aria-label={`Potřebuje pozornost: ${needsCount}`}>
            <Bell size={17} />
            {needsCount > 0 && <span className="dotcount">{needsCount}</span>}
          </button>
          <div className="me">
            <Avatar name={actor.name} />
            <div className="who">
              <div className="strong small">{actor.name}</div>
              <div className="small muted">{ROLE_LABEL[actor.role]} · {s.agencyName}</div>
            </div>
          </div>
        </header>

        {s.demo && (
          <div className="demo-banner no-print">
            <span><strong>Demo.</strong> Smyšlená data uložená jen ve vašem prohlížeči. AI píše šablona, publikace je simulovaná.</span>
            {confirmReset ? (
              <>
                <span>Smazat vaše změny?</span>
                <button onClick={async () => { await s.demo!.reset(); navigate('/'); s.logout(); }}>Ano, obnovit</button>
                <button onClick={() => setConfirmReset(false)}>Ne</button>
              </>
            ) : (
              <button onClick={() => setConfirmReset(true)}>Obnovit ukázková data</button>
            )}
            <button onClick={() => { navigate('/'); s.logout(); }}>Přepnout uživatele</button>
          </div>
        )}

        <main className="content" ref={mainRef}>
          <Routes>
            <Route path="/" element={staff ? <Dashboard /> : <Approvals />} />
            <Route path="/kalendar" element={<CalendarPage />} />
            <Route path="/schvalovani" element={<Approvals />} />
            <Route path="/posty/novy" element={staff ? <PostEditor /> : <Navigate to="/" />} />
            <Route path="/posty/:id" element={<PostEditor />} />
            <Route path="/klienti" element={staff ? <Clients /> : <Navigate to="/" />} />
            <Route path="/znacky/:id" element={staff ? <BrandPage /> : <Navigate to="/" />} />
            <Route path="/reporty" element={<Reports />} />
            <Route path="/tym" element={actor.role === 'owner' ? <Team /> : <Navigate to="/" />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  count?: number;
  icon?: typeof Users;
  hideMobile?: boolean;
}

function isActive(item: NavItem, path: string) {
  if (item.end) return path === item.to;
  return path === item.to || path.startsWith(`${item.to}/`);
}

/** Horní záložky s klouzavou pilulkou (kopie řady v inverzních barvách oříznutá na aktivní položku). */
function PillTabs({ items, go }: { items: NavItem[]; go(to: string): void }) {
  const loc = useLocation();
  const box = useRef<HTMLElement>(null);
  const pill = useRef<HTMLDivElement>(null);
  const activeIdx = items.findIndex((t) => isActive(t, loc.pathname));
  const first = useRef(true);

  useLayoutEffect(() => {
    const target = box.current?.querySelectorAll<HTMLElement>('.tabs-row > a')[activeIdx] ?? null;
    if (pill.current) slidePill(pill.current, target, !first.current, 'x');
    first.current = false;
  }, [activeIdx, items.length]);

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      const target = box.current?.querySelectorAll<HTMLElement>('.tabs-row > a')[activeIdx] ?? null;
      if (pill.current) slidePill(pill.current, target, false, 'x');
    });
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [activeIdx]);

  const label = (t: NavItem) => (
    <>
      {t.label}
      {!!t.count && <span className="count">{t.count}</span>}
    </>
  );
  return (
    <nav className="tabs" aria-label="Hlavní navigace" ref={box}>
      <div className="tabs-row">
        {items.map((t, i) => (
          <a key={t.to} href={`#${t.to}`} aria-current={i === activeIdx ? 'page' : undefined}
            onClick={(e) => { e.preventDefault(); go(t.to); }}>{label(t)}</a>
        ))}
      </div>
      <div className="tabs-row tabs-pill" ref={pill} aria-hidden>
        {items.map((t) => <span key={t.to}>{label(t)}</span>)}
      </div>
    </nav>
  );
}

/** Plovoucí dock: svislá klouzavá pilulka; na desktopu jde rozbalit na panel s popisky. */
function Dock({ items, staff, go, theme, onLogout, demo }: { items: NavItem[]; staff: boolean; go(to: string): void; theme: { dark: boolean; toggle(): void }; onLogout(): void; demo: boolean }) {
  const loc = useLocation();
  const nav = useNavigate();
  const ref = useRef<HTMLElement>(null);
  const pill = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem('ms-dock') === 'open';
    } catch {
      return false;
    }
  });
  const activeIdx = items.findIndex((t) => isActive(t, loc.pathname));

  const place = useCallback((animate: boolean) => {
    const target = ref.current?.querySelectorAll<HTMLElement>('.dock-links > a')[activeIdx] ?? null;
    const horizontal = matchMedia('(max-width: 760px)').matches;
    if (pill.current) slidePill(pill.current, target, animate, horizontal ? 'x' : 'y');
  }, [activeIdx]);

  useLayoutEffect(() => {
    place(!first.current);
    first.current = false;
  }, [place]);

  useEffect(() => {
    const ro = new ResizeObserver(() => place(false));
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [place]);

  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--dock-w', open ? '216px' : '64px');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle() {
    const next = !open;
    try {
      localStorage.setItem('ms-dock', next ? 'open' : 'closed');
    } catch {
      /* ignore */
    }
    const root = document.documentElement;
    const D = 0.62, E = 'power3.inOut';
    if (reduced()) {
      root.style.setProperty('--dock-w', next ? '216px' : '64px');
      flushSync(() => setOpen(next));
      place(false);
      return;
    }
    // Panel se rozbalí po hraně ořezu, ikony doklouzají (Flip), popisky naběhnou postupně.
    const state = Flip.getState(ref.current!.querySelectorAll('.di'));
    flushSync(() => setOpen(next));
    gsap.fromTo(root, { '--dock-w': next ? '64px' : '216px' }, { '--dock-w': next ? '216px' : '64px', duration: D, ease: E, onUpdate: () => place(false), onComplete: () => place(false) });
    Flip.from(state, { duration: D, ease: E });
    if (next) {
      gsap.fromTo(ref.current!.querySelectorAll('.dl'), { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: D, stagger: 0.018, delay: D * 0.4, ease: 'power3.out' });
    }
  }

  return (
    <nav className={`dock ${open ? 'open' : ''}`} aria-label="Rychlá navigace" ref={ref}>
      <button className="dock-toggle hide-m" onClick={toggle} aria-label={open ? 'Sbalit panel' : 'Rozbalit panel'} aria-expanded={open}>
        <span className="di">{open ? <ChevronsLeft size={16} /> : <ChevronsRight size={16} />}</span>
        <span className="dl">{open ? 'Sbalit' : ''}</span>
        {!open && <span className="tip">Rozbalit</span>}
      </button>
      {staff && (
        <button className="plus" onClick={() => nav('/posty/novy')} aria-label="Nový post">
          <span className="di"><Plus size={20} /></span><span className="dl">Nový post</span>
          {!open && <span className="tip">Nový post</span>}
        </button>
      )}
      <div className="dock-links-wrap">
        <div className="dock-links">
          {items.map((d) => {
            const I = d.icon!;
            return (
              <a key={d.to} href={`#${d.to}`} className={d.hideMobile ? 'hide-m' : ''} aria-label={d.label} aria-current={isActive(d, loc.pathname) ? 'page' : undefined}
                onClick={(e) => { e.preventDefault(); go(d.to); }}>
                <span className="di"><I size={18} /></span><span className="dl">{d.label}</span>
                {!open && <span className="tip">{d.label}</span>}
              </a>
            );
          })}
        </div>
        <div className="dock-links dock-pill" ref={pill} aria-hidden>
          {items.map((d) => {
            const I = d.icon!;
            return <span key={d.to} className={d.hideMobile ? 'hide-m' : ''}><span className="di"><I size={18} /></span><span className="dl">{d.label}</span></span>;
          })}
        </div>
      </div>
      <span className="sep" />
      <button onClick={theme.toggle} aria-label="Přepnout světlý a tmavý režim">
        <span className="di">{theme.dark ? <Sun size={18} /> : <Moon size={18} />}</span><span className="dl">{theme.dark ? 'Světlý režim' : 'Tmavý režim'}</span>
        {!open && <span className="tip">{theme.dark ? 'Světlý režim' : 'Tmavý režim'}</span>}
      </button>
      <button className="hide-m" onClick={onLogout} aria-label={demo ? 'Přepnout uživatele' : 'Odhlásit'}>
        <span className="di"><LogOut size={18} /></span><span className="dl">{demo ? 'Přepnout uživatele' : 'Odhlásit'}</span>
        {!open && <span className="tip">{demo ? 'Přepnout uživatele' : 'Odhlásit'}</span>}
      </button>
    </nav>
  );
}
