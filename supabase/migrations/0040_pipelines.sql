-- 0040_pipelines.sql
-- Multiple pipelines per org. Each pipeline owns its own committed→closeout
-- stage backbone (order, parallels, timeline); work streams belong to ONE
-- pipeline and are built / duplicated / customized within it.
--
-- "Intake" stays a single UNIVERSAL triage stage (pipeline_id IS NULL) that
-- every study passes through before it's committed onto its pipeline. That
-- keeps the org-wide unique(org_id, key) constraint intact and the existing
-- intake logic (study.stage_key = 'intake') working untouched.
--
-- Backfills a default pipeline per org and attaches every existing non-intake
-- stage and every work stream to it, so nothing breaks. Idempotent.

create table if not exists public.pipelines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active',   -- active | archived
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pipelines_org_idx on public.pipelines (org_id, status, position);
alter table public.pipelines enable row level security;

drop policy if exists pipelines_select on public.pipelines;
create policy pipelines_select on public.pipelines
  for select to authenticated using (public.is_org_member(org_id));
drop policy if exists pipelines_modify on public.pipelines;
create policy pipelines_modify on public.pipelines
  for all to authenticated
  using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

drop trigger if exists touch_pipelines_updated_at on public.pipelines;
create trigger touch_pipelines_updated_at before update on public.pipelines
  for each row execute function public.touch_updated_at();

-- Scope stages and work streams to a pipeline (nullable: intake stays unscoped).
alter table public.pipeline_stages add column if not exists pipeline_id uuid references public.pipelines(id) on delete cascade;
alter table public.workstreams     add column if not exists pipeline_id uuid references public.pipelines(id) on delete cascade;
create index if not exists pipeline_stages_pipeline_idx on public.pipeline_stages (pipeline_id, position);
create index if not exists workstreams_pipeline_idx on public.workstreams (pipeline_id);

-- Backfill existing orgs: one default pipeline; attach non-intake stages + all
-- work streams. Intake (key = 'intake') is left universal (pipeline_id NULL).
do $$
declare o record; pid uuid;
begin
  for o in select id from public.orgs loop
    select id into pid from public.pipelines where org_id = o.id order by position, created_at limit 1;
    if pid is null then
      insert into public.pipelines (org_id, name, description, position)
      values (o.id, 'Standard pipeline', 'Your default pipeline — every study runs on this until more are defined.', 0)
      returning id into pid;
    end if;
    update public.pipeline_stages set pipeline_id = pid
      where org_id = o.id and pipeline_id is null and key <> 'intake';
    update public.workstreams set pipeline_id = pid
      where org_id = o.id and pipeline_id is null;
  end loop;
end$$;

-- New orgs: after seed_org_data lays down the core stages, create a default
-- pipeline and attach the seeded non-intake stages. The 'zz_' name guarantees
-- this fires AFTER the alphabetically-earlier seed triggers on public.orgs.
create or replace function public.seed_pipeline_v0040()
returns trigger language plpgsql security definer set search_path = public as $t$
declare pid uuid;
begin
  insert into public.pipelines (org_id, name, description, position)
  values (new.id, 'Standard pipeline', 'Your default pipeline — every study runs on this until more are defined.', 0)
  returning id into pid;
  update public.pipeline_stages set pipeline_id = pid
    where org_id = new.id and pipeline_id is null and key <> 'intake';
  update public.workstreams set pipeline_id = pid
    where org_id = new.id and pipeline_id is null;
  return new;
end$t$;

drop trigger if exists zz_seed_pipeline_0040 on public.orgs;
create trigger zz_seed_pipeline_0040 after insert on public.orgs
  for each row execute function public.seed_pipeline_v0040();
