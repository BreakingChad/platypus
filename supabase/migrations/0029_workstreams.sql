-- 0029: workstreams as first-class objects (Wave S2).
-- A workstream is a named pathway a study is put on at intake/creation. The
-- per-stage modules stay shared org config for now; the workstream is the
-- selectable wrapper studies are assigned to (one pathway per study type is
-- best practice). Idempotent + backfills a default per org.

create table if not exists public.workstreams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active',   -- active | archived
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists workstreams_org_idx on public.workstreams (org_id, status);
alter table public.workstreams enable row level security;

drop policy if exists workstreams_select on public.workstreams;
create policy workstreams_select on public.workstreams
  for select to authenticated using (public.is_org_member(org_id));
drop policy if exists workstreams_modify on public.workstreams;
create policy workstreams_modify on public.workstreams
  for all to authenticated
  using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

drop trigger if exists touch_workstreams_updated_at on public.workstreams;
create trigger touch_workstreams_updated_at before update on public.workstreams
  for each row execute function public.touch_updated_at();

alter table public.studies add column if not exists workstream_id uuid references public.workstreams(id) on delete set null;

-- Backfill: one default workstream per org, then point existing studies at it.
do $$
declare o record; wid uuid;
begin
  for o in select id from public.orgs loop
    select id into wid from public.workstreams where org_id = o.id and is_default limit 1;
    if wid is null then
      insert into public.workstreams (org_id, name, description, is_default)
      values (o.id, 'Standard startup', 'Default pathway — every study starts here until more are defined.', true)
      returning id into wid;
    end if;
    update public.studies set workstream_id = wid where org_id = o.id and workstream_id is null;
  end loop;
end$$;
