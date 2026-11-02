# @ms/api – backend

HTTP API a publikační worker nad doménovým jádrem `@ms/core`. Fastify, Postgres (node-postgres),
TypeScript spouštěný přes `tsx` (bez build kroku).

## Rychlý start

```bash
# 1) Postgres: lokální jednorázový cluster (port 54329, trust auth, jen localhost)
apps/api/scripts/test-db.sh start        # vypíše DATABASE_URL a TEST_DATABASE_URL

# 2) Konfigurace
cp apps/api/.env.example apps/api/.env   # a upravte; skripty .env samy NEnačítají:
set -a; . apps/api/.env; set +a

# 3) Migrace + demo data (hesla demo1234)
pnpm --filter @ms/api seed

# 4) Server a worker
pnpm --filter @ms/api dev                # nebo start; server při startu spustí migrace
pnpm --filter @ms/api worker             # samostatný proces (nebo WORKER_IN_PROCESS=true)
```

Demo přihlášení (po `seed`): `tereza@studio-dobryden.example` (majitelka),
`marek@studio-dobryden.example` (manažer), `jana@pekarna-ulipy.example` (klientka), heslo `demo1234`.
Seed odmítne běžet, pokud agentura `studio-dobry-den` už existuje, a celý běží v jedné transakci.

Skripty: `dev`, `start`, `worker`, `migrate`, `seed`, `set-password`, `test`, `typecheck`.

### Testy

`pnpm --filter @ms/api test`. Testy čtou `TEST_DATABASE_URL`; pokud chybí, globální setup sám spustí
`scripts/test-db.sh start`. Každý testovací soubor (a u kontraktu a scénářů služeb každý test) dostane
vlastní čerstvé schéma s migracemi, které se po testu smaže.

- `pg-store.test.ts` – sdílený kontrakt `storeContract` z core + specifika Postgresu (přesnost časů,
  české řazení, vnořené transakce, složené FK, RLS s nevlastnickou rolí).
- `pg-services.test.ts` – scénáře ze `services.test.ts` nad Postgresem (izolace tenantů, schválení přes
  token, ztracená odpověď a dohledání, souběžné workery, reporty, celý demo seed).
- `http.test.ts` – HTTP vrstva přes `fastify.inject` (login, cookie, RPC, 401/403/404/415/422/429/500).
- `adapters/claude-assistant.test.ts` – parsování JSON odpovědí AI (bez síťových volání).

## Proměnné prostředí

| Proměnná | Výchozí | Popis |
|---|---|---|
| `DATABASE_URL` | – (povinná) | Postgres connection string |
| `TEST_DATABASE_URL` | – | DB pro testy (jinak lokální cluster) |
| `PORT` | `3001` | Port serveru |
| `HOST` | `127.0.0.1` (prod `0.0.0.0`) | Adresa serveru |
| `NODE_ENV` | – | `production` zapne `Secure` cookie a povinný `APP_ORIGIN` |
| `APP_ORIGIN` | dev: `http://localhost:5173,http://localhost:3001` | Povolené originy pro POST (čárkou oddělené) |
| `TRUST_PROXY` | `false` | Za reverzní proxy kvůli správné IP pro rate limit |
| `WORKER_IN_PROCESS` | `false` | Spustit worker uvnitř serveru |
| `ANTHROPIC_API_KEY` | – | Pokud je, použije se Claude; jinak šablonový asistent (bez AI) |
| `AI_MODEL` | `claude-sonnet-5-5` | Model pro Claude |
| `PUBLISHER` | `simulated` | `simulated` nebo `ayrshare` (zatím jen stub) |
| `AYRSHARE_API_KEY` | – | Bez něj `PUBLISHER=ayrshare` spadne při startu |
| `WEB_DIST` | `apps/web/dist` | Sestavený web, který server volitelně servíruje (SPA fallback) |

`SESSION_SECRET` není potřeba: session token se do DB ukládá jen jako SHA-256 hash.

## Architektura

```
prohlížeč ──cookie──▶ Fastify ──▶ invoke(services, actor, method, args) ──▶ @ms/core služby ──▶ PgStore ──▶ Postgres
                         │                                                       ▲
                         └─ /api/public/* ─▶ invokePublic (token) ────────────────┘
worker (30 s) ──▶ publishing.runDue() ──▶ claimDue (FOR UPDATE SKIP LOCKED) ──▶ SocialPublisher
       (1 h)  ──▶ reports.collectMetrics(agencyId) pro každou agenturu
```

### HTTP rozhraní

- `POST /api/rpc/:method` – tělo `{ "args": [...] }`, hlavička `x-agency-id`, vyžaduje session.
  Odpověď `{ "result": ... }`; doménová chyba `{ "error": { code, message, details } }` se statusem
  z `httpStatus` (404/403/422/409/410); ostatní chyby 500 s obecnou zprávou (detail jen v logu).
- `POST /api/public/:method` – `getApproval`, `decide`, `comment` (lze i s prefixem `public.`), bez
  session, rate limit 60/min na IP.
- `POST /api/auth/login {email, password}`, `POST /api/auth/logout`, `GET /api/auth/me` →
  `{ result: { user, agencies } }`. Login má rate limit 10/min na IP.
- `GET /healthz` – ověří i spojení s DB.

### RPC allowlist

Volatelné jsou jen metody z `ACTOR_METHODS` / `PUBLIC_METHODS` v `packages/core/src/rpc.ts`
(kontrola přes `hasOwnProperty`, takže ani `constructor` apod.). Worker metody (`publishing.runDue`,
`reports.collectMetrics`) z HTTP volat nejdou.

### Živé členství

`Actor` se na každém requestu znovu odvodí přes `tenancy.resolveActor(userId, x-agency-id)` z aktuální
tabulky `memberships`. V session je jen `userId`; role ani agentura se nikde nekešují, takže odebraný
člen nebo změna role platí okamžitě. Cizí `x-agency-id` → 403.

### Autentizace (dočasná, do ADR k autentizaci)

- Hesla: `node:crypto` scrypt (N=16384, r=8, p=1, 64 B), sůl 16 B na uživatele, v tabulce
  `credentials` (mimo doménový `User`). Neexistující e-mail se ověřuje proti falešnému hashi kvůli
  časování. Změna hesla smaže všechny session uživatele.
- Session: náhodný 32B token v cookie `ms_session` (`HttpOnly`, `SameSite=Lax`, `Secure` v produkci,
  14 dní). V tabulce `sessions` je jen SHA-256 tokenu; worker jednou za hodinu maže prošlé.
- CSRF: všechny POSTy musí mít `Content-Type: application/json` (jinak 415) – to prohlížeč cross-site
  bez CORS preflightu neumí a CORS nepovolujeme; `Origin` musí odpovídat `APP_ORIGIN` (jinak 403).

### Outbox publikace

Naplánování postu vytvoří v transakci úlohy v `publish_jobs` (jedna na post × verze × síť) s unikátním
`idempotency_key` (`insertIfAbsent` = `ON CONFLICT DO NOTHING` + select). Worker si úlohy atomicky
zamkne (`FOR UPDATE SKIP LOCKED`, `locked_until`), takže souběžné workery nikdy nedostanou stejnou
úlohu (ověřeno testem). Ztracená odpověď poskytovatele → stav `unknown` → před dalším pokusem se
výsledek dohledá přes `lookup` (žádná slepá duplicita).

### Schéma

Relační tabulky se snake_case sloupci, `agency_id` na každé tenant tabulce a **složené cizí klíče**
`(agency_id, x_id) → x(agency_id, id)`, takže záznam z principu nemůže odkazovat na záznam jiné
agentury. JSONB jen pro vnořené hodnoty (profil značky, overrides/media/versions postu, data auditu).
Unikátní: `agencies.slug`, `lower(users.email)`, `memberships(agency_id,user_id)`,
`accounts(agency_id,brand_id,network)`, `approvals.token`, `publish_jobs.idempotency_key`,
`metrics(agency_id,post_id,network)`. Sloupce `created_by`, `requested_by`, `author_id`,
`account_id` (v úlohách) záměrně nemají FK – záznamy musí přežít odchod uživatele / odpojení účtu.
Časy jsou `timestamptz` s ms přesností; `toISOString()` vrací přesně uloženou hodnotu, na čemž stojí
optimistický zámek `posts.update` (`where updated_at = $expected`). Sloupec `seq` (identity) drží
pořadí vložení jako tie-breaker, aby řazení odpovídalo `MemoryStore`. Jména klientů a značek se řadí
ICU collation `cs-x-icu`.

Migrace: `migrations/NNN_*.sql`, runner v `src/db.ts` (tabulka `schema_migrations`, každá migrace
v transakci, advisory lock proti souběhu). Spouští je `pnpm migrate`, `seed` i start serveru.

### Row Level Security

Na tenant tabulkách (`clients`, `brands`, `accounts`, `posts`, `comments`, `approvals`, `publish_jobs`,
`metrics`, `audit_events`) je RLS **zapnuté** s politikou
`agency_id = current_setting('app.agency_id', true)`. **Není vynucené** (`FORCE` chybí): aplikace se
v MVP připojuje jako vlastník tabulek, na kterého se RLS nevztahuje. Primární ochranou je, že každý
dotaz `PgStore` filtruje podle `agency_id` (a kontrakt to testuje); RLS je druhá linie.

Dotazy, které legitimně běží napříč agenturami, jdou už teď přes úzké `SECURITY DEFINER` funkce, takže
pod RLS fungují beze změny: `app_approval_by_token` (getByToken), `app_claim_due_jobs` (claimDue),
`app_unknown_jobs` (listUnknown). `agencies`, `users`, `memberships` RLS nemají (resolveActor a
myAgencies je čtou podle userId napříč agenturami).

**Jak RLS skutečně vynutit** (ověřeno testem v `pg-store.test.ts` s nevlastnickou rolí):

1. Vytvořit nevlastnickou roli pro aplikaci a dát jí jen DML práva:
   ```sql
   create role ms_app login password '…';
   grant usage on schema public to ms_app;
   grant select, insert, update, delete on all tables in schema public to ms_app;
   grant execute on all functions in schema public to ms_app;
   ```
   Migrace dál pouštět rolí vlastníka.
2. V `PgStore` každý agency-scoped dotaz spustit v transakci s
   `select set_config('app.agency_id', $agencyId, true)` (lokální pro transakci – nesmí to být
   session-level `SET`, spojení se v poolu sdílí). Nejjednodušší je obalit `q()` a `tx()`.
3. Worker (`collectMetrics` přes všechny agentury, výčet agentur) buď nastavuje `app.agency_id` pro
   každou agenturu zvlášť, nebo běží pod samostatnou rolí s `BYPASSRLS`.
4. Volitelně `alter table … force row level security`, aby se RLS vztahovalo i na vlastníka.

### Adaptéry (`src/adapters`)

- **AI**: s `ANTHROPIC_API_KEY` `ClaudeAssistant` (`@anthropic-ai/sdk`, `messages.create`, prompty
  `buildDraftPrompt`/`buildRewritePrompt` z core). Varianty se parsují robustně (code fence, text okolo
  JSONu, holé pole); nevalidní odpověď → `DomainError('invalid')` s českou zprávou. Shrnutí reportu
  dostane jen předpočítaná čísla s pokynem nic nevymýšlet; když AI selže, core použije šablonu.
  Bez klíče `TemplateAssistant` (UI ho označuje jako „bez AI“).
- **Publikace**: výchozí `SimulatedPublisher` (nic se nikam neposílá). `AyrsharePublisher` je jen
  označený stub (viz níže). **Metriky**: `SimulatedMetrics`.

## Co není hotové

- **Autentizace je dočasná**: chybí registrace přes UI, reset/změna hesla, ověření e-mailu, 2FA,
  pozvánky e-mailem (pozvaný člen nemá heslo, dokud mu ho admin nenastaví přes
  `NEW_PASSWORD=… pnpm --filter @ms/api set-password <email>`), čeká na ADR.
- **RLS není vynucené** – aplikace běží jako vlastník tabulek; postup výše.
- **Ayrshare** je stub: bez `AYRSHARE_API_KEY` spadne při startu, s klíčem každá publikace skončí
  `failed` „neimplementováno“. Skutečná integrace (API, idempotence, mapování chyb, webhooky) chybí.
- **Simulovaná publikace drží stav v paměti procesu** – `lookup` po restartu workeru nic nenajde.
- **Metriky jsou simulované**, žádné napojení na skutečná API sítí.
- **Rate limit je v paměti** jednoho procesu (pevné okno); pro víc instancí je potřeba sdílený
  (Redis / proxy). Chybí i limit na RPC a na AI volání (náklady).
- Chyby AI poskytovatele (výpadek, timeout) u `ai.draft`/`ai.rewrite` končí obecnou 500, ne
  přívětivou doménovou chybou.
- Žádné CORS (web musí běžet na stejném originu nebo přes dev proxy), žádné bezpečnostní hlavičky
  (CSP, HSTS) – patří na reverzní proxy nebo `@fastify/helmet`.
- Chybí upload médií (jen URL v `MediaRef`), e-mailové notifikace, strukturované metriky/tracing,
  zálohy a retenční politika pro `audit_events` a `sessions`.
- Výčet agentur ve workeru je sekvenční a bez dávkování – pro desítky agentur OK, pro stovky ne.
- `seed` je jen pro demo/dev (v produkci vyžaduje `ALLOW_DEMO_SEED=1`).
