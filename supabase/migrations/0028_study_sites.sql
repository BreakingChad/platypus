-- 0028: a study runs at MANY sites at once (Salesforce-style related list).
-- study_sites is the M:N join; studies.site_id stays as the "primary" site
-- for back-compat and the highlights strip. Per-site status + activation
-- date live on the join so each site advances on its own. Idempotent.
create table if not exists public.study_sites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  study_id uuid not null references public.studies(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  is_primary boolean not null default false,
  site_status text not null default 'selected',   -- selected | activated | closed
  activated_date date,
  note text,
  created_at timestamptz not null default now(),
  unique (study_id, site_id)
);
create index if not exists study_sites_study_idx on public.study_sites (study_id);
create index if not exists study_sites_site_idx on public.study_sites (site_id);
alter table public.study_sites enable row level security;

drop policy if exists study_sites_select on public.study_sites;
create policy study_sites_select on public.study_sites
  for select to authenticated using (public.is_org_member(org_id));
drop policy if exists study_sites_modify on public.study_sites;
create policy study_sites_modify on public.study_sites
  for all to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
