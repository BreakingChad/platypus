-- 0035_workstream_stages.sql
-- Per-work-stream FLOW. Until now the stage order / parallel grouping / target
-- days / terminal lived on the org-wide pipeline_stages, so every work stream
-- shared one sequence. This makes the flow per work stream:
--   pipeline_stages  = the shared stage LIBRARY (key, label, color, identity)
--   workstream_stages = each work stream's pathway over those stages
-- Modules already key off (stage_key, workstream_id), so they fit unchanged.
-- pipeline_stages keeps its position/parallel_group/target_days/terminal columns
-- (non-destructive) — they remain the canonical order for org-wide board/kanban
-- views that mix studies from many work streams. Idempotent.

create table if not exists public.workstream_stages (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  workstream_id  uuid not null references public.workstreams(id) on delete cascade,
  stage_key      text not null,            -- references a pipeline_stages.key in this org
  position       integer not null default 0,
  parallel_group integer,
  target_days    integer not null default 14,
  terminal       boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workstream_id, stage_key)
);
create index if not exists workstream_stages_ws_idx on public.workstream_stages (workstream_id, position);

drop trigger if exists touch_workstream_stages_updated_at on public.workstream_stages;
create trigger touch_workstream_stages_updated_at before update on public.workstream_stages
  for each row execute function public.touch_updated_at();

alter table public.workstream_stages enable row level security;
drop policy if exists workstream_stages_select on public.workstream_stages;
create policy workstream_stages_select on public.workstream_stages
  for select to authenticated using (public.is_org_member(org_id));
drop policy if exists workstream_stages_modify on public.workstream_stages;
create policy workstream_stages_modify on public.workstream_stages
  for all to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- Backfill: seed every work stream's flow from the current shared pipeline so
-- existing behavior is preserved, then each stream can diverge.
insert into public.workstream_stages (org_id, workstream_id, stage_key, position, parallel_group, target_days, terminal)
select w.org_id, w.id, ps.key, ps.position, ps.parallel_group, ps.target_days, ps.terminal
from public.workstreams w
join public.pipeline_stages ps on ps.org_id = w.org_id
on conflict (workstream_id, stage_key) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='workstream_stages'
  ) then
    execute 'alter publication supabase_realtime add table public.workstream_stages';
  end if;
end$$;
