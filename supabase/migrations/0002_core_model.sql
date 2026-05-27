-- =============================================================================
-- Platypus 0002 — core domain model.
--
-- The operating-model tables that the team designs: pipeline_stages,
-- teams + team_roles + team_role_holders, access_roles, studies (with a
-- custom_field_values JSONB column), and field_definitions (the source of
-- truth for which fields exist).
--
-- All per-org, all RLS-protected. A trigger seeds sensible defaults on every
-- new org so the app is immediately usable. The existing "My Organization"
-- from Phase A is backfilled at the bottom of this migration.
-- =============================================================================

-- Enums ----------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname='field_type') then
    create type public.field_type as enum ('text','date','number','dropdown','boolean','person','lookup','json');
  end if;
  if not exists (select 1 from pg_type where typname='field_kind') then
    create type public.field_kind as enum ('standard','custom');
  end if;
  if not exists (select 1 from pg_type where typname='field_edit_tier') then
    create type public.field_edit_tier as enum ('admin','coordinator','any');
  end if;
  if not exists (select 1 from pg_type where typname='hierarchy_key') then
    create type public.hierarchy_key as enum ('director','manager','coordinator','specialist','support');
  end if;
end$$;

create table if not exists public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  key text not null, label text not null,
  icon_key text default 'layers', color text default '#6366F1',
  target_days integer not null default 14,
  owner_team_id uuid, terminal boolean not null default false,
  is_core boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (org_id, key)
);
create index if not exists pipeline_stages_org_idx on public.pipeline_stages (org_id, position);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null, color text default '#4F46E5', charter text,
  status text not null default 'active',
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists teams_org_idx on public.teams (org_id, position);

create table if not exists public.team_roles (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  title text not null,
  hierarchy_key public.hierarchy_key not null default 'coordinator',
  level integer not null default 3,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists team_roles_team_idx on public.team_roles (team_id, position);

create table if not exists public.team_role_holders (
  id uuid primary key default gen_random_uuid(),
  team_role_id uuid not null references public.team_roles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (team_role_id, user_id)
);

create table if not exists public.access_roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null, description text, builtin boolean not null default false,
  modules jsonb not null default '{}'::jsonb,
  portfolio_scope text not null default 'assigned',
  ta_scope text[] not null default '{}', site_scope text[] not null default '{}',
  function_overrides jsonb not null default '{}'::jsonb,
  admin_scope text[] not null default '{}',
  status text not null default 'active',
  former_names text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists access_roles_org_idx on public.access_roles (org_id);

create table if not exists public.studies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  code text not null, title text not null, nct text, sponsor text,
  therapeutic_area text, phase text, stage_key text, study_kind text,
  priority text default 'standard', intake_status text default 'submitted',
  committed_at timestamptz, intake_date timestamptz,
  closed boolean not null default false, closed_at timestamptz,
  pi_name text,
  custom_field_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists studies_org_idx on public.studies (org_id);
create index if not exists studies_org_stage_idx on public.studies (org_id, stage_key);

create table if not exists public.field_definitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  entity_type text not null default 'study',
  key text not null, label text not null, section text not null,
  field_type public.field_type not null default 'text',
  kind public.field_kind not null default 'standard',
  enabled boolean not null default true,
  required boolean not null default false,
  lock_after_commit boolean not null default false,
  edit_tier public.field_edit_tier not null default 'admin',
  position integer not null default 0,
  options jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, entity_type, key)
);
create index if not exists field_defs_org_idx on public.field_definitions (org_id, entity_type, position);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

drop trigger if exists touch_studies_updated_at on public.studies;
create trigger touch_studies_updated_at before update on public.studies
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_field_defs_updated_at on public.field_definitions;
create trigger touch_field_defs_updated_at before update on public.field_definitions
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_access_roles_updated_at on public.access_roles;
create trigger touch_access_roles_updated_at before update on public.access_roles
  for each row execute function public.touch_updated_at();

alter table public.pipeline_stages enable row level security;
alter table public.teams enable row level security;
alter table public.team_roles enable row level security;
alter table public.team_role_holders enable row level security;
alter table public.access_roles enable row level security;
alter table public.studies enable row level security;
alter table public.field_definitions enable row level security;

drop policy if exists pipeline_stages_select on public.pipeline_stages;
create policy pipeline_stages_select on public.pipeline_stages
  for select to authenticated using (public.is_org_member(org_id));
drop policy if exists pipeline_stages_modify on public.pipeline_stages;
create policy pipeline_stages_modify on public.pipeline_stages
  for all to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams
  for select to authenticated using (public.is_org_member(org_id));
drop policy if exists teams_modify on public.teams;
create policy teams_modify on public.teams
  for all to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

drop policy if exists team_roles_select on public.team_roles;
create policy team_roles_select on public.team_roles
  for select to authenticated using (exists (select 1 from public.teams t where t.id = team_id and public.is_org_member(t.org_id)));
drop policy if exists team_roles_modify on public.team_roles;
create policy team_roles_modify on public.team_roles
  for all to authenticated
  using (exists (select 1 from public.teams t where t.id = team_id and public.is_org_admin(t.org_id)))
  with check (exists (select 1 from public.teams t where t.id = team_id and public.is_org_admin(t.org_id)));

drop policy if exists team_role_holders_select on public.team_role_holders;
create policy team_role_holders_select on public.team_role_holders
  for select to authenticated
  using (exists (select 1 from public.team_roles r join public.teams t on t.id = r.team_id
                 where r.id = team_role_id and public.is_org_member(t.org_id)));
drop policy if exists team_role_holders_modify on public.team_role_holders;
create policy team_role_holders_modify on public.team_role_holders
  for all to authenticated
  using (exists (select 1 from public.team_roles r join public.teams t on t.id = r.team_id
                 where r.id = team_role_id and public.is_org_admin(t.org_id)))
  with check (exists (select 1 from public.team_roles r join public.teams t on t.id = r.team_id
                      where r.id = team_role_id and public.is_org_admin(t.org_id)));

drop policy if exists access_roles_select on public.access_roles;
create policy access_roles_select on public.access_roles
  for select to authenticated using (public.is_org_member(org_id));
drop policy if exists access_roles_modify on public.access_roles;
create policy access_roles_modify on public.access_roles
  for all to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

drop policy if exists studies_select on public.studies;
create policy studies_select on public.studies
  for select to authenticated using (public.is_org_member(org_id));
drop policy if exists studies_modify on public.studies;
create policy studies_modify on public.studies
  for all to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

drop policy if exists field_defs_select on public.field_definitions;
create policy field_defs_select on public.field_definitions
  for select to authenticated using (public.is_org_member(org_id));
drop policy if exists field_defs_modify on public.field_definitions;
create policy field_defs_modify on public.field_definitions
  for all to authenticated using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

create or replace function public.seed_default_org_data(_org_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  s jsonb; f jsonb; ar jsonb;
  stages jsonb := $j$[
    {"key":"intake","label":"Intake","icon_key":"inbox","color":"#6366F1","target_days":14,"terminal":false,"is_core":true,"position":1},
    {"key":"study_startup","label":"Study startup","icon_key":"folder","color":"#0284C7","target_days":14,"terminal":false,"is_core":true,"position":2},
    {"key":"feasibility","label":"Feasibility","icon_key":"search","color":"#059669","target_days":21,"terminal":false,"is_core":true,"position":3},
    {"key":"site_selection","label":"Site selection","icon_key":"building","color":"#b45309","target_days":30,"terminal":false,"is_core":true,"position":4},
    {"key":"regulatory","label":"Regulatory / eReg","icon_key":"shield","color":"#7C3AED","target_days":45,"terminal":false,"is_core":true,"position":5},
    {"key":"contract_budget","label":"Contract & budget","icon_key":"dollar","color":"#BE185D","target_days":45,"terminal":false,"is_core":true,"position":6},
    {"key":"site_initiation","label":"Site initiation","icon_key":"rocket","color":"#4F46E5","target_days":30,"terminal":false,"is_core":true,"position":7},
    {"key":"activation","label":"Activated","icon_key":"check","color":"#059669","target_days":0,"terminal":true,"is_core":true,"position":8}
  ]$j$::jsonb;
  fields jsonb := $j$[
    {"key":"shortTitle","label":"Short title","section":"Organizational","field_type":"text","position":1},
    {"key":"protocolNumber","label":"Protocol number","section":"Organizational","field_type":"text","position":2},
    {"key":"protocolVersion","label":"Protocol version","section":"Organizational","field_type":"text","position":3},
    {"key":"protocolDate","label":"Protocol date","section":"Organizational","field_type":"date","position":4},
    {"key":"cro","label":"CRO","section":"Organizational","field_type":"text","position":5},
    {"key":"disease","label":"Disease / indication","section":"Organizational","field_type":"text","position":6},
    {"key":"intervention","label":"Intervention","section":"Organizational","field_type":"text","position":7},
    {"key":"primarySiteName","label":"Primary study site","section":"Per-Site","field_type":"text","position":8},
    {"key":"sponsorSiteNumber","label":"Sponsor site #","section":"Per-Site","field_type":"text","position":9},
    {"key":"estimatedActivationDate","label":"Estimated activation date","section":"Per-Site","field_type":"date","position":10},
    {"key":"irbProtocolNumber","label":"IRB protocol #","section":"Regulatory","field_type":"text","position":11},
    {"key":"irbType","label":"IRB type","section":"Regulatory","field_type":"dropdown","position":12},
    {"key":"irbName","label":"IRB name","section":"Regulatory","field_type":"text","position":13},
    {"key":"indIdeNumber","label":"IND / IDE number","section":"Regulatory","field_type":"text","position":14},
    {"key":"fdaRegulated","label":"FDA regulated","section":"Regulatory","field_type":"boolean","position":15},
    {"key":"fundingSource","label":"Funding source","section":"Financial","field_type":"text","position":16},
    {"key":"startupFees","label":"Startup fees","section":"Financial","field_type":"number","position":17},
    {"key":"costCenter","label":"Cost center","section":"Financial","field_type":"text","position":18},
    {"key":"paymentTerms","label":"Payment terms","section":"Financial","field_type":"text","position":19},
    {"key":"accrualGoal","label":"Enrollment target","section":"Operational","field_type":"number","position":20},
    {"key":"edcPlatform","label":"EDC platform","section":"Operational","field_type":"text","position":21},
    {"key":"trainingStatus","label":"Training status","section":"Operational","field_type":"dropdown","position":22}
  ]$j$::jsonb;
  access_recs jsonb := $j$[
    {"name":"Director","desc":"Cross-portfolio authority. Configures the app and approves exceptions.","modules":{"all":"admin"},"scope":"all"},
    {"name":"Operations Manager","desc":"Day-to-day operations across teams.","modules":{"all":"edit"},"scope":"all"},
    {"name":"Coordinator","desc":"Per-study execution.","modules":{"studies":"edit","documents":"read"},"scope":"assigned"},
    {"name":"Regulatory","desc":"Document-centric. Approvals, expirations, binder hygiene.","modules":{"documents":"edit","studies":"read"},"scope":"assigned"},
    {"name":"Principal Investigator","desc":"Clinical lead. Approvals and escalations.","modules":{"studies":"read","approvals":"edit"},"scope":"assigned"}
  ]$j$::jsonb;
begin
  for s in select * from jsonb_array_elements(stages) loop
    insert into public.pipeline_stages (org_id, key, label, icon_key, color, target_days, terminal, is_core, position)
    values (_org_id, s->>'key', s->>'label', s->>'icon_key', s->>'color',
            (s->>'target_days')::int, (s->>'terminal')::bool, (s->>'is_core')::bool, (s->>'position')::int)
    on conflict (org_id, key) do nothing;
  end loop;
  for f in select * from jsonb_array_elements(fields) loop
    insert into public.field_definitions (org_id, entity_type, key, label, section, field_type, kind, enabled, required, lock_after_commit, edit_tier, position)
    values (_org_id, 'study', f->>'key', f->>'label', f->>'section', (f->>'field_type')::public.field_type,
            'standard', true, false, false, 'admin', (f->>'position')::int)
    on conflict (org_id, entity_type, key) do nothing;
  end loop;
  for ar in select * from jsonb_array_elements(access_recs) loop
    insert into public.access_roles (org_id, name, description, builtin, modules, portfolio_scope)
    values (_org_id, ar->>'name', ar->>'desc', true, (ar->'modules')::jsonb, ar->>'scope');
  end loop;
end;
$$;

create or replace function public.handle_new_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.seed_default_org_data(new.id); return new; end;
$$;

drop trigger if exists seed_org_data on public.orgs;
create trigger seed_org_data after insert on public.orgs
  for each row execute function public.handle_new_org();

do $$
declare o record;
begin
  for o in select id from public.orgs where not exists (
    select 1 from public.pipeline_stages ps where ps.org_id = orgs.id
  ) loop
    perform public.seed_default_org_data(o.id);
  end loop;
end$$;
