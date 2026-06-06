-- 0033_investigators.sql
-- Principal Investigators (and sub-investigators) as a first-class object.
-- Hierarchy the product models:
--   Org → Sites → Investigators (people credentialed AT a site)
--   Org → Studies → study_sites → PI picked from THAT site's investigators
-- Investigators carry the credential data feasibility & regulatory depend on
-- (degree, NPI, license, CV/1572/FD on file, GCP training + expiry).
-- An investigator can be affiliated with MANY sites (network model) via the
-- site_investigators join. Idempotent / non-destructive.

-- ── investigator catalog ────────────────────────────────────────────────
create table if not exists public.investigators (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  name          text not null,
  degree        text,                       -- MD, DO, PhD, PharmD, RN…
  email         text,
  phone         text,
  npi           text,                       -- National Provider Identifier
  license_number text,
  license_state text,
  status        text not null default 'active',  -- active | inactive
  cv_on_file              boolean not null default false,
  cv_date                 date,
  form_1572_on_file       boolean not null default false,
  financial_disclosure_on_file boolean not null default false,
  gcp_training_date       date,
  gcp_training_expires    date,
  notes         text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists investigators_org_idx on public.investigators (org_id, status);

drop trigger if exists touch_investigators_updated_at on public.investigators;
create trigger touch_investigators_updated_at before update on public.investigators
  for each row execute function public.touch_updated_at();

alter table public.investigators enable row level security;
drop policy if exists investigators_select on public.investigators;
create policy investigators_select on public.investigators
  for select to authenticated using (public.is_org_member(org_id));
-- Investigators are operational data (people come and go); members manage them,
-- matching study_sites — not admin-gated like the pipeline structure.
drop policy if exists investigators_modify on public.investigators;
create policy investigators_modify on public.investigators
  for all to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- ── site ⇄ investigator affiliation (M:N) ───────────────────────────────
create table if not exists public.site_investigators (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  site_id         uuid not null references public.sites(id) on delete cascade,
  investigator_id uuid not null references public.investigators(id) on delete cascade,
  is_primary      boolean not null default false,  -- the site's primary investigator
  created_at      timestamptz not null default now(),
  unique (site_id, investigator_id)
);
create index if not exists site_investigators_site_idx on public.site_investigators (site_id);
create index if not exists site_investigators_inv_idx  on public.site_investigators (investigator_id);

alter table public.site_investigators enable row level security;
drop policy if exists site_investigators_select on public.site_investigators;
create policy site_investigators_select on public.site_investigators
  for select to authenticated using (public.is_org_member(org_id));
drop policy if exists site_investigators_modify on public.site_investigators;
create policy site_investigators_modify on public.site_investigators
  for all to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- ── per-study-site PI becomes a real reference ──────────────────────────
-- Keep study_sites.pi_name (0032) for back-compat / legacy display; the FK is
-- the source of truth going forward.
alter table public.study_sites
  add column if not exists pi_investigator_id uuid
  references public.investigators(id) on delete set null;
create index if not exists study_sites_pi_inv_idx on public.study_sites (pi_investigator_id);

-- ── realtime publication ────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['investigators','site_investigators'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end$$;
