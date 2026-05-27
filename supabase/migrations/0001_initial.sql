-- =============================================================================
-- Platypus — initial migration.
--
-- Sets up the foundational tenancy model:
--   • orgs            — every tenant
--   • profiles        — one per auth.users
--   • org_members     — many-to-many with a tier (owner / admin / member)
-- Plus RLS policies, and a trigger that on new-user signup creates a
-- default org + profile + owner membership in one transaction.
--
-- Apply via Supabase Studio → SQL Editor, or `supabase db push`.
-- =============================================================================

-- Extensions ------------------------------------------------------------------
create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "citext";         -- case-insensitive emails

-- Enums -----------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'sponsor_mode') then
    create type public.sponsor_mode as enum ('site', 'sponsor');
  end if;
  if not exists (select 1 from pg_type where typname = 'member_tier') then
    create type public.member_tier as enum ('owner', 'admin', 'member');
  end if;
end$$;

-- orgs ------------------------------------------------------------------------
create table if not exists public.orgs (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  slug                text unique,
  sponsor_mode        public.sponsor_mode not null default 'site',
  region              text default 'us',
  timezone            text default 'America/New_York',
  project_id_prefix   text default 'STU',
  owner_id            uuid not null references auth.users(id) on delete restrict,
  created_at          timestamptz not null default now()
);
create index if not exists orgs_owner_idx on public.orgs (owner_id);

-- profiles --------------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             citext not null unique,
  full_name         text,
  title             text,
  phone             text,
  default_org_id    uuid references public.orgs(id) on delete set null,
  created_at        timestamptz not null default now()
);

-- org_members -----------------------------------------------------------------
create table if not exists public.org_members (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  tier        public.member_tier not null default 'member',
  created_at  timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists org_members_user_idx on public.org_members (user_id);
create index if not exists org_members_org_idx  on public.org_members (org_id);

-- Helper: am I a member of this org? -----------------------------------------
-- security definer so RLS policies can call it without recursive permission
-- checks against org_members itself.
create or replace function public.is_org_member(_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = _org_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = _org_id
      and m.user_id = auth.uid()
      and m.tier in ('owner','admin')
  );
$$;

grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_admin(uuid)  to authenticated;

-- Row Level Security ---------------------------------------------------------
alter table public.orgs        enable row level security;
alter table public.profiles    enable row level security;
alter table public.org_members enable row level security;

-- orgs: readable to any member; insertable by authenticated users (the trigger
-- below also creates one on signup); updatable by owners/admins of the org.
drop policy if exists "orgs_select_members" on public.orgs;
create policy "orgs_select_members" on public.orgs
  for select to authenticated
  using ( public.is_org_member(id) );

drop policy if exists "orgs_insert_self" on public.orgs;
create policy "orgs_insert_self" on public.orgs
  for insert to authenticated
  with check ( owner_id = auth.uid() );

drop policy if exists "orgs_update_admins" on public.orgs;
create policy "orgs_update_admins" on public.orgs
  for update to authenticated
  using ( public.is_org_admin(id) )
  with check ( public.is_org_admin(id) );

-- profiles: each user reads/updates only their own.
drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self" on public.profiles
  for select to authenticated
  using ( id = auth.uid() );

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using ( id = auth.uid() )
  with check ( id = auth.uid() );

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles
  for insert to authenticated
  with check ( id = auth.uid() );

-- org_members: members of an org can see the membership list.
-- Inserts/updates restricted to owners/admins of that org.
drop policy if exists "org_members_select_members" on public.org_members;
create policy "org_members_select_members" on public.org_members
  for select to authenticated
  using ( public.is_org_member(org_id) );

drop policy if exists "org_members_modify_admins" on public.org_members;
create policy "org_members_modify_admins" on public.org_members
  for all to authenticated
  using ( public.is_org_admin(org_id) )
  with check ( public.is_org_admin(org_id) );

-- Self-insert allowed so the handle_new_user trigger (which runs as the
-- signing-up user via security definer) can add the owner row.
drop policy if exists "org_members_insert_self" on public.org_members;
create policy "org_members_insert_self" on public.org_members
  for insert to authenticated
  with check ( user_id = auth.uid() );

-- handle_new_user: on signup, create a default org + profile + owner row.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  derived_name text;
begin
  derived_name := coalesce(
    new.raw_user_meta_data->>'org_name',
    'My Organization'
  );

  insert into public.orgs (name, owner_id)
  values (derived_name, new.id)
  returning id into new_org_id;

  insert into public.profiles (id, email, default_org_id)
  values (new.id, new.email, new_org_id);

  insert into public.org_members (org_id, user_id, tier)
  values (new_org_id, new.id, 'owner');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Done. ----------------------------------------------------------------------
