-- 0012_sites.sql
-- Sites as first-class records (the "site information collection system").
-- Structured columns for identity; everything else lives in profile jsonb,
-- driven by the org's entity_type='site' field_definitions (seeded in 0005b).
-- Idempotent / non-destructive.

create table if not exists public.sites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  name        text not null,
  status      text not null default 'active',
  city        text,
  state       text,
  country     text,
  profile     jsonb not null default '{}'::jsonb,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists sites_org_idx on public.sites (org_id, status);

drop trigger if exists touch_sites_updated_at on public.sites;
create trigger touch_sites_updated_at before update on public.sites
  for each row execute function public.touch_updated_at();

alter table public.sites enable row level security;
drop policy if exists sites_select on public.sites;
create policy sites_select on public.sites
  for select to authenticated using (public.is_org_member(org_id));
drop policy if exists sites_modify on public.sites;
create policy sites_modify on public.sites
  for all to authenticated
  using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

alter table public.studies add column if not exists site_id uuid
  references public.sites(id) on delete set null;
create index if not exists studies_site_idx on public.studies (site_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='sites'
  ) then
    execute 'alter publication supabase_realtime add table public.sites';
  end if;
end$$;
