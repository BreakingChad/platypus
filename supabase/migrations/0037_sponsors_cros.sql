-- 0037_sponsors_cros.sql
-- Sponsors and CROs as first-class objects (same pattern as sites/investigators).
-- studies.sponsor was free text → drift, no roll-ups, nowhere for sponsor detail.
-- Now: org-level catalogs you pick from; studies reference them by FK. The old
-- studies.sponsor text is kept as a legacy fallback and backfilled into records.
-- Idempotent / non-destructive.

-- ── sponsors catalog ────────────────────────────────────────────────────
create table if not exists public.sponsors (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  name          text not null,
  sponsor_type  text,                 -- industry | nih | foundation | investigator_initiated | other
  contact_name  text,
  contact_email text,
  contact_phone text,
  portal_url    text,
  payment_terms text,
  notes         text,
  status        text not null default 'active',  -- active | inactive
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, name)
);
create index if not exists sponsors_org_idx on public.sponsors (org_id, status);

drop trigger if exists touch_sponsors_updated_at on public.sponsors;
create trigger touch_sponsors_updated_at before update on public.sponsors
  for each row execute function public.touch_updated_at();

alter table public.sponsors enable row level security;
drop policy if exists sponsors_select on public.sponsors;
create policy sponsors_select on public.sponsors
  for select to authenticated using (public.is_org_member(org_id));
drop policy if exists sponsors_modify on public.sponsors;
create policy sponsors_modify on public.sponsors
  for all to authenticated using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- ── CROs catalog ────────────────────────────────────────────────────────
create table if not exists public.cros (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  name          text not null,
  contact_name  text,
  contact_email text,
  contact_phone text,
  notes         text,
  status        text not null default 'active',
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, name)
);
create index if not exists cros_org_idx on public.cros (org_id, status);

drop trigger if exists touch_cros_updated_at on public.cros;
create trigger touch_cros_updated_at before update on public.cros
  for each row execute function public.touch_updated_at();

alter table public.cros enable row level security;
drop policy if exists cros_select on public.cros;
create policy cros_select on public.cros
  for select to authenticated using (public.is_org_member(org_id));
drop policy if exists cros_modify on public.cros;
create policy cros_modify on public.cros
  for all to authenticated using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- ── study references ────────────────────────────────────────────────────
alter table public.studies add column if not exists sponsor_id uuid references public.sponsors(id) on delete set null;
alter table public.studies add column if not exists cro_id uuid references public.cros(id) on delete set null;
create index if not exists studies_sponsor_idx on public.studies (sponsor_id);
create index if not exists studies_cro_idx on public.studies (cro_id);

-- ── backfill: distinct existing sponsor strings → sponsor records, then link ──
insert into public.sponsors (org_id, name)
select distinct org_id, btrim(sponsor)
from public.studies
where sponsor is not null and btrim(sponsor) <> ''
on conflict (org_id, name) do nothing;

update public.studies s
set sponsor_id = sp.id
from public.sponsors sp
where sp.org_id = s.org_id
  and s.sponsor is not null
  and btrim(s.sponsor) = sp.name
  and s.sponsor_id is null;

-- ── realtime ────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['sponsors','cros'] loop
    if not exists (select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end$$;
