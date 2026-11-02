-- Row Level Security jako druhá linie obrany (první je povinné agency_id v každém dotazu Store).
--
-- Politika: řádek je vidět jen když agency_id = current_setting('app.agency_id', true).
-- RLS je ZAPNUTÉ, ale NE vynucené (bez FORCE): aplikace v MVP se připojuje jako vlastník
-- tabulek, na kterého se RLS nevztahuje. Postup pro nevlastnickou roli je v README.md.
--
-- agencies, users a memberships RLS nemají: resolveActor a myAgencies je čtou napříč
-- agenturami podle userId (kdo jsem a kde jsem členem) a nejsou to data klientů.

do $$
declare t text;
begin
  foreach t in array array['clients', 'brands', 'accounts', 'posts', 'comments', 'approvals', 'publish_jobs', 'metrics', 'audit_events']
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (agency_id = current_setting(''app.agency_id'', true)) '
      'with check (agency_id = current_setting(''app.agency_id'', true))', t);
  end loop;
end $$;

-- Dotazy, které legitimně běží napříč agenturami, jdou přes SECURITY DEFINER funkce.
-- Běží s právy vlastníka (obchází RLS), ale dělají jen tuto jednu úzkou věc.
-- search_path je zafixovaný na schéma, ve kterém migrace běžela.

-- Schvalovací odkaz: token teprve určuje agenturu.
create function app_approval_by_token(p_token text) returns setof approvals
language sql stable security definer set search_path from current as $$
  select * from approvals where token = p_token
$$;

-- Worker: atomický claim splatných úloh (FOR UPDATE SKIP LOCKED = dva workery nikdy nedostanou stejnou úlohu).
create function app_claim_due_jobs(p_now timestamptz, p_lock_until timestamptz, p_limit integer) returns setof publish_jobs
language sql volatile security definer set search_path from current as $$
  with due as (
    select id from publish_jobs
    where status = 'pending' and run_at <= p_now and (locked_until is null or locked_until < p_now)
    order by run_at, seq
    limit p_limit
    for update skip locked
  )
  update publish_jobs j
     set status = 'running', locked_until = p_lock_until, attempts = j.attempts + 1, updated_at = p_now
    from due
   where j.id = due.id
  returning j.*
$$;

-- Worker: úlohy s neznámým výsledkem k dohledání u poskytovatele.
create function app_unknown_jobs(p_limit integer) returns setof publish_jobs
language sql stable security definer set search_path from current as $$
  select * from publish_jobs where status = 'unknown' order by updated_at, seq limit p_limit
$$;
