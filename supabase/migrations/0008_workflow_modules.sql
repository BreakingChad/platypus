-- 0008_workflow_modules.sql
-- Workflow modules: admin-designed groups of task templates attached to a
-- specific (stage, owning team). When a study enters that stage, the app
-- spawns a task per template from the configured modules. Pure-additive
-- schema; idempotent.

create table if not exists public.workflow_modules (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  stage_key       text not null,
  owner_team_id   uuid references public.teams(id) on delete set null,
  name            text not null,
  description     text,
  enabled         boolean not null default true,
  position        integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists workflow_modules_org_idx     on public.workflow_modules (org_id, stage_key, position);
create index if not exists workflow_modules_team_idx    on public.workflow_modules (owner_team_id);

drop trigger if exists touch_workflow_modules_updated_at on public.workflow_modules;
create trigger touch_workflow_modules_updated_at before update on public.workflow_modules
  for each row execute function public.touch_updated_at();

create table if not exists public.workflow_task_templates (
  id              uuid primary key default gen_random_uuid(),
  module_id       uuid not null references public.workflow_modules(id) on delete cascade,
  kind            public.task_kind not null default 'manual',
  title           text not null,
  description     text,
  due_offset_days integer,
  assigned_to_role_id uuid references public.team_roles(id) on delete set null,
  position        integer not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists workflow_task_templates_module_idx
  on public.workflow_task_templates (module_id, position);

alter table public.workflow_modules        enable row level security;
alter table public.workflow_task_templates enable row level security;

drop policy if exists workflow_modules_select on public.workflow_modules;
create policy workflow_modules_select on public.workflow_modules
  for select to authenticated using (public.is_org_member(org_id));

drop policy if exists workflow_modules_modify on public.workflow_modules;
create policy workflow_modules_modify on public.workflow_modules
  for all to authenticated
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

drop policy if exists workflow_task_templates_select on public.workflow_task_templates;
create policy workflow_task_templates_select on public.workflow_task_templates
  for select to authenticated
  using (exists (
    select 1 from public.workflow_modules m
    where m.id = module_id and public.is_org_member(m.org_id)
  ));

drop policy if exists workflow_task_templates_modify on public.workflow_task_templates;
create policy workflow_task_templates_modify on public.workflow_task_templates
  for all to authenticated
  using (exists (
    select 1 from public.workflow_modules m
    where m.id = module_id and public.is_org_admin(m.org_id)
  ))
  with check (exists (
    select 1 from public.workflow_modules m
    where m.id = module_id and public.is_org_admin(m.org_id)
  ));

do $$
declare t text;
begin
  for t in select unnest(array['workflow_modules','workflow_task_templates']) loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end$$;
