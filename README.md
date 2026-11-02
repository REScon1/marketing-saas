# Postovna: MVP marketingové aplikace pro agentury

Pracovní název. Agentura v aplikaci plánuje posty pro klienty, nechá si od AI navrhnout texty podle profilu značky,
pošle je klientovi ke schválení (i přes odkaz bez registrace), naplánuje publikaci a klientovi ukáže měsíční report.
Rozsah vychází z dokumentu „Návrh scope MVP — AI Marketing SaaS“ a technického auditu fáze 0.

## Co je v repozitáři

| Část | Co dělá | Stav |
| --- | --- | --- |
| `packages/core` | Doménové jádro: tenancy agentura → klient → značka, oprávnění, stavový automat postu, schvalování, outbox publikace, metriky, reporty, kontrola značky, rozhraní AI | hotové, testy |
| `apps/api` | HTTP API nad PostgreSQL: přihlášení, session, RPC s allowlistem, veřejné schvalovací odkazy, worker publikace, adaptér Claude | viz `apps/api/README.md` |
| `apps/web` | Webová aplikace v češtině (React). Běží proti API, nebo jako samostatné demo v prohlížeči | hotové, e2e průchod |

Demo a server používají **stejné jádro a stejný allowlist volání** (`packages/core/src/rpc.ts`). Demo tedy ukazuje
skutečnou logiku a oprávnění, jen místo Postgresu ukládá do prohlížeče.

## Spuštění

```bash
pnpm install
pnpm -r test                 # testy jádra a API
pnpm --filter @ms/web build:demo   # demo jako jeden HTML soubor: apps/web/dist-demo/
pnpm --filter @ms/web dev:demo     # demo s hot reloadem na http://localhost:5173
```

Server s databází: viz `apps/api/README.md` (migrace, seed s ukázkovými daty, `pnpm --filter @ms/api dev`,
pak `pnpm --filter @ms/web dev`, Vite přesměruje `/api` na port 3001).

## Jak MVP řeší body auditu

| Audit | Řešení v kódu |
| --- | --- |
| G4 záměna agentura / klient / značka | Každý dotaz úložiště vyžaduje `agencyId`; Actor se skládá z **živého členství** při každém volání; role `client` je vázaná na jednoho klienta; politika `default deny` v `policy.ts`; Postgres navíc RLS. Testy izolace v `services.test.ts` a kontraktu úložiště. |
| G2 duplicita při opakování | Outbox `publish_jobs` s unikátním klíčem `post:verze:síť`; ztracená odpověď = stav `unknown` a **dohledání u poskytovatele před dalším pokusem**, nikdy slepé opakování. Test „ztracená odpověď“. |
| G5 staré operace | Schvaluje se konkrétní **verze** postu; změna obsahu zruší schválení, odkaz i čekající úlohy publikace. |
| G7 přístupy k sítím | Publikace přes rozhraní `SocialPublisher` (adaptér na unified API). Teď simulace. |
| G9 n8n | Nepoužito; vlastní worker nad outboxem. |
| P3.1 VELNIRO | Mimo MVP, žádné napojení. |

## Vzhled a ovládání

Podle referenčních videí od zadavatele (ukázky „Social Media Management“ a „Creator Analytics“):

- **Přehled**: pozdrav se souhrnnými čísly (dosah a zapojení za 30 dní, posty tento týden), karta „Na řadě“ s odpočtem do publikace, seznam „Brzy“ a panel „Potřebuje vás“ s akcemi přímo v seznamu (zkusit znovu, naplánovat, upravit).
- **Publikační kalendář**: pohledy Týden / Měsíc / Seznam, filtry sítí a stavů, mini kalendář, panel nenaplánovaných postů. **Přetažením** post dostane nebo změní termín.
- **Horní lišta**: přepínač značek (filtruje celou aplikaci), upozornění, plovoucí dock s rychlým „+ Nový post“.
- **Reporty**: tmavý panel s kumulovaným dosahem, karty s mini grafy, nejlepší posty s náhledy.
- **Obrázky u postů**: nahrání až 4 obrázků, automatické zmenšení v prohlížeči, náhled v podobě sítě.
- Světlý režim (mátový, tmavé prvky, žlutý akcent) a tmavý režim (teplý, oranžový akcent).

Z referencí záměrně chybí **Inbox** a **Listening**: podle scope MVP patří až za pilot.

## Co je simulované nebo chybí

- **Publikace na sítě** je simulovaná (`SimulatedPublisher`). Adaptér pro unified API (Ayrshare apod.) čeká na výběr dodavatele a klíč.
- **Metriky** jsou simulované, deterministické. Skutečné se budou brát z téhož poskytovatele.
- **AI** v demu je šablona, ne model. Na serveru se s `ANTHROPIC_API_KEY` použije Claude.
- **Přihlášení** je dočasné (e-mail + heslo), čeká na rozhodnutí o identitě (auth ADR z auditu).
- **E-maily** (pozvánky, odkaz ke schválení, připomínky) se zatím neodesílají; odkaz se kopíruje ručně.
- **Média**: obrázky se ukládají jako data URI přímo k postu (max. 4 × ~1 MB). Pro ostrý provoz patří do objektového úložiště; video zatím nejde.
- Billing, white-label, TikTok/YouTube, inbox komentářů a GA4/Google Ads reporting jsou podle scope až po pilotu.

## Rozhodnutí, která jsem udělal za vás (k potvrzení při předvedení)

1. **Název** „Postovna“ je jen pracovní.
2. **Schvalování**: klient schvaluje každý post; jde vypnout per značku („schvaluje agentura“). Odkaz platí 14 dní a jen pro jednu verzi.
3. **Vrácení k úpravě** vyžaduje komentář; schválení ne.
4. **Klient nevidí koncepty**, jen to, co mu agentura poslala.
5. **Kontrola značky blokuje** odeslání při zakázaném slovu nebo překročení limitu znaků; počet hashtagů a emoji jen varuje.
6. **Úprava naplánovaného postu** ho vrátí do konceptu a ke schválení (bezpečnější varianta).
7. **Role**: majitel (vše + tým), manažer (obsah, klienti, značky), klient (schvaluje, komentuje, vidí reporty svého klienta).
8. **Model tenancy**: jedna sdílená databáze s `agency_id` a RLS, ne databáze per agentura (ADR otevřené, viz audit).
9. **Sítě v MVP**: Facebook, Instagram, LinkedIn.
10. **Časové pásmo** Europe/Prague pro zobrazení i zadávání termínů.
