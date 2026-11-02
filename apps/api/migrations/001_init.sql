-- Základní schéma. Identifikátory jsou text (UUID generuje aplikace přes crypto.randomUUID()).
-- Časy jsou timestamptz s přesností na milisekundy, které aplikace vrací jako ISO řetězce.
-- Každá tenant tabulka nese agency_id; cizí klíče mezi tenant tabulkami jsou složené
-- (agency_id, id), takže záznam nemůže odkazovat na záznam jiné agentury ani omylem.
-- Sloupec seq zachovává pořadí vložení (shodné chování s MemoryStore při shodných časech).

create table agencies (
  id          text primary key,
  name        text not null,
  slug        text not null,
  plan        text not null check (plan in ('pilot', 'starter', 'pro')),
  created_at  timestamptz not null,
  seq         bigint generated always as identity,
  constraint agencies_slug_key unique (slug)
);

create table users (
  id          text primary key,
  email       text not null,
  name        text not null,
  created_at  timestamptz not null,
  seq         bigint generated always as identity
);
create unique index users_email_lower_key on users (lower(email));

-- Přihlašovací údaje odděleně od doménového User (dočasné řešení do ADR k autentizaci).
create table credentials (
  user_id     text primary key references users (id) on delete cascade,
  algo        text not null default 'scrypt',
  params      jsonb not null,
  salt        bytea not null,
  hash        bytea not null,
  updated_at  timestamptz not null default now()
);

-- Ukládá se jen SHA-256 tokenu; samotný token zná jen prohlížeč (httpOnly cookie).
create table sessions (
  token_hash  bytea primary key,
  user_id     text not null references users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  user_agent  text,
  ip          text
);
create index sessions_user_idx on sessions (user_id);
create index sessions_expires_idx on sessions (expires_at);

create table clients (
  id             text primary key,
  agency_id      text not null references agencies (id),
  name           text not null,
  contact_email  text,
  archived       boolean not null default false,
  created_at     timestamptz not null,
  seq            bigint generated always as identity,
  constraint clients_agency_id_key unique (agency_id, id)
);
create index clients_agency_idx on clients (agency_id);

create table memberships (
  id          text primary key,
  agency_id   text not null references agencies (id),
  user_id     text not null references users (id),
  role        text not null check (role in ('owner', 'manager', 'client')),
  client_id   text,
  created_at  timestamptz not null,
  seq         bigint generated always as identity,
  constraint memberships_agency_user_key unique (agency_id, user_id),
  constraint memberships_client_fk foreign key (agency_id, client_id) references clients (agency_id, id),
  constraint memberships_client_role_chk check ((role = 'client') = (client_id is not null))
);
create index memberships_user_idx on memberships (user_id);

create table brands (
  id                        text primary key,
  agency_id                 text not null references agencies (id),
  client_id                 text not null,
  name                      text not null,
  profile                   jsonb not null,
  requires_client_approval  boolean not null,
  archived                  boolean not null default false,
  created_at                timestamptz not null,
  seq                       bigint generated always as identity,
  constraint brands_agency_id_key unique (agency_id, id),
  constraint brands_client_fk foreign key (agency_id, client_id) references clients (agency_id, id)
);
create index brands_agency_client_idx on brands (agency_id, client_id);

-- account_id v publish_jobs záměrně nemá FK: úloha musí přežít i odpojení/smazání účtu
-- (a kontrakt Store pracuje i s neexistujícím účtem).
create table accounts (
  id            text primary key,
  agency_id     text not null references agencies (id),
  brand_id      text not null,
  network       text not null check (network in ('facebook', 'instagram', 'linkedin')),
  handle        text not null,
  provider_ref  text,
  status        text not null check (status in ('connected', 'expired', 'disconnected')),
  created_at    timestamptz not null,
  seq           bigint generated always as identity,
  constraint accounts_agency_brand_network_key unique (agency_id, brand_id, network),
  constraint accounts_brand_fk foreign key (agency_id, brand_id) references brands (agency_id, id)
);

-- created_by / requested_by / author_id nemají FK na users: záznam musí přežít odchod uživatele.
create table posts (
  id            text primary key,
  agency_id     text not null references agencies (id),
  brand_id      text not null,
  client_id     text not null,
  title         text not null,
  body          text not null,
  overrides     jsonb not null default '{}'::jsonb,
  networks      text[] not null,
  media         jsonb not null default '[]'::jsonb,
  status        text not null check (status in ('draft', 'in_review', 'changes_requested', 'approved', 'scheduled', 'publishing', 'published', 'failed')),
  scheduled_at  timestamptz,
  published_at  timestamptz,
  version       integer not null,
  versions      jsonb not null default '[]'::jsonb,
  ai_assisted   boolean not null default false,
  created_by    text not null,
  created_at    timestamptz not null,
  updated_at    timestamptz not null,
  seq           bigint generated always as identity,
  constraint posts_agency_id_key unique (agency_id, id),
  constraint posts_brand_fk foreign key (agency_id, brand_id) references brands (agency_id, id),
  constraint posts_client_fk foreign key (agency_id, client_id) references clients (agency_id, id)
);
create index posts_agency_schedule_idx on posts (agency_id, scheduled_at, created_at);
create index posts_agency_brand_idx on posts (agency_id, brand_id);
create index posts_agency_client_idx on posts (agency_id, client_id);
create index posts_agency_status_idx on posts (agency_id, status);

create table comments (
  id            text primary key,
  agency_id     text not null references agencies (id),
  post_id       text not null,
  author_id     text,
  author_name   text not null,
  author_role   text not null check (author_role in ('owner', 'manager', 'client', 'guest')),
  body          text not null,
  post_version  integer not null,
  created_at    timestamptz not null,
  seq           bigint generated always as identity,
  constraint comments_post_fk foreign key (agency_id, post_id) references posts (agency_id, id)
);
create index comments_post_idx on comments (agency_id, post_id, created_at);

create table approvals (
  id                  text primary key,
  agency_id           text not null references agencies (id),
  post_id             text not null,
  post_version        integer not null,
  token               text not null,
  status              text not null check (status in ('pending', 'approved', 'changes_requested', 'superseded')),
  requested_by        text not null,
  requested_at        timestamptz not null,
  expires_at          timestamptz not null,
  decided_at          timestamptz,
  decided_by_name     text,
  decided_by_user_id  text,
  note                text,
  seq                 bigint generated always as identity,
  constraint approvals_token_key unique (token),
  constraint approvals_post_fk foreign key (agency_id, post_id) references posts (agency_id, id)
);
create index approvals_post_idx on approvals (agency_id, post_id, requested_at);
create index approvals_pending_idx on approvals (agency_id) where status = 'pending';

create table publish_jobs (
  id               text primary key,
  agency_id        text not null references agencies (id),
  post_id          text not null,
  post_version     integer not null,
  network          text not null check (network in ('facebook', 'instagram', 'linkedin')),
  account_id       text not null,
  idempotency_key  text not null,
  status           text not null check (status in ('pending', 'running', 'succeeded', 'failed', 'unknown', 'cancelled')),
  attempts         integer not null default 0,
  run_at           timestamptz not null,
  locked_until     timestamptz,
  external_id      text,
  external_url     text,
  last_error       text,
  created_at       timestamptz not null,
  updated_at       timestamptz not null,
  seq              bigint generated always as identity,
  constraint publish_jobs_idempotency_key_key unique (idempotency_key),
  constraint publish_jobs_post_fk foreign key (agency_id, post_id) references posts (agency_id, id)
);
create index publish_jobs_post_idx on publish_jobs (agency_id, post_id);
create index publish_jobs_due_idx on publish_jobs (run_at) where status = 'pending';
create index publish_jobs_unknown_idx on publish_jobs (updated_at) where status = 'unknown';

create table metrics (
  agency_id     text not null references agencies (id),
  post_id       text not null,
  brand_id      text not null,
  network       text not null check (network in ('facebook', 'instagram', 'linkedin')),
  reach         integer not null,
  impressions   integer not null,
  engagements   integer not null,
  clicks        integer not null,
  collected_at  timestamptz not null,
  seq           bigint generated always as identity,
  constraint metrics_pkey primary key (agency_id, post_id, network),
  constraint metrics_post_fk foreign key (agency_id, post_id) references posts (agency_id, id),
  constraint metrics_brand_fk foreign key (agency_id, brand_id) references brands (agency_id, id)
);
create index metrics_brand_idx on metrics (agency_id, brand_id);

create table audit_events (
  id          text primary key,
  agency_id   text not null references agencies (id),
  actor_id    text,
  actor_name  text not null,
  action      text not null,
  entity      text not null,
  entity_id   text not null,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null,
  seq         bigint generated always as identity
);
create index audit_agency_time_idx on audit_events (agency_id, created_at desc);
create index audit_entity_idx on audit_events (agency_id, entity_id, created_at desc);
