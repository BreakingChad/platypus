-- 0004_audit_and_tasks.sql
-- Adds two foundational tables:
--   • audit_events — hash-chained log of every meaningful action
--   • tasks         — study-scoped, role/user-assignable work items
-- Both per-org, RLS-protected, with sensible defaults.

-- ============================================================================
-- audit_events
-- ============================================================================
create table if not exists public.audit_events (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  entity_type     text not null,
  entity_id       uuid,
  action          text not null,
  actor_id        uuid references auth.users(id) on delete set null,
  actor_email     text,
  payload         jsonb not null default '{}'::jsonb,
  prev_hash       text,
  event_hash      text not null,
  ip_address      inet,
  user_agent      text,
  created_at      timestamptz not null default now()
);
create index if not exists audit_events_org_idx    on public.audit_events (org_id, created_at desc);
create index if not exists audit_events_entity_idx on public.audit_events (entity_type, entity_id, created_at desc);
create index if not exists audit_events_actor_idx  on public.audit_events (actor_id, created_at desc);

-- ============================================================================
-- tasks
-- ============================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname='task_status') then
    create type public.task_status as enum ('open','in_progress','done','skipped','cancelled');
  end if;
  if not exists (select 1 from pg_type where typname='task_kind') then
    create type public.task_kind as enum ('date','handoff','escalation','external_handoff','manual');
  end if;
end$$;

create table if not exists public.tasks (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  study_id        uuid references public.studies(id) on delete cascade,
  stage_key       text,
  kind            public.task_kind not null default 'manual',
  title           text not null,
  description     text,
  status          public.task_status not null default 'open',
  due_at          timestamptz,
  assigned_to_user_id   uuid references auth.users(id) on delete set null,
  assigned_to_role_id   uuid references public.team_roles(id) on delete set null,
  completed_at    timestamptz,
  completed_by    uuid references auth.users(id) on delete set null,
  created_by      uuid references auth.users(id) on delete set null,
  position        integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists tasks_org_status_idx     on public.tasks (org_id, status);
create index if not exists tasks_study_idx          on public.tasks (study_id, status);
create index if not exists tasks_assignee_user_idx  on public.tasks (assigned_to_user_id, status);
create index if not exists tasks_assignee_role_idx  on public.tasks (assigned_to_role_id, status);
create index if not exists tasks_due_idx            on public.tasks (org_id, due_at) where status in ('open','in_progress');

drop trigger if exists touch_tasks_updated_at on public.tasks;
create trigger touch_tasks_updated_at before update on public.tasks
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.audit_events enable row level security;
alter table public.tasks        enable row level security;

drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events
  for select to authenticated using (public.is_org_member(org_id));

drop policy if exists audit_events_insert on public.audit_events;
create policy audit_events_insert on public.audit_events
  for insert to authenticated with check (public.is_org_member(org_id) and actor_id = auth.uid());

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated using (public.is_org_member(org_id));

drop policy if exists tasks_insert_admin on public.tasks;
create policy tasks_insert_admin on public.tasks
  for insert to authenticated with check (public.is_org_admin(org_id));

drop policy if exists tasks_update_admin on public.tasks;
create policy tasks_update_admin on public.tasks
  for update to authenticated
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

drop policy if exists tasks_update_assignee on public.tasks;
create policy tasks_update_assignee on public.tasks
  for update to authenticated
  using (public.is_org_member(org_id) and assigned_to_user_id = auth.uid())
  with check (public.is_org_member(org_id) and assigned_to_user_id = auth.uid());

drop policy if exists tasks_delete_admin on public.tasks;
create policy tasks_delete_admin on public.tasks
  for delete to authenticated using (public.is_org_admin(org_id));

-- ============================================================================
-- Append to realtime publication
-- ============================================================================
do $$
declare t text;
begin
  for t in select unnest(array['audit_events','tasks']) loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end$$;
