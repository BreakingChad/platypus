-- 0023: platform console (Wave M).
-- A developer-level surface ABOVE orgs: platform admins see and manage every
-- org, create new ones, and invite people into them. New signups join the
-- org they were invited to; everyone else keeps the legacy shared-org path.
-- Idempotent.

-- 1. Who runs the platform ----------------------------------------------------
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.platform_admins where user_id = auth.uid()) $$;

drop policy if exists platform_admins_select on public.platform_admins;
create policy platform_admins_select on public.platform_admins
  for select to authenticated
  using (user_id = auth.uid() or public.is_platform_admin());
-- No insert/delete policies on purpose: seed platform admins in the SQL editor.

-- 2. Org invites ---------------------------------------------------------------
create table if not exists public.org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  email text not null,
  tier public.member_tier not null default 'member',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (org_id, email)
);
alter table public.org_invites enable row level security;

drop policy if exists org_invites_select on public.org_invites;
create policy org_invites_select on public.org_invites
  for select to authenticated
  using (public.is_platform_admin() or public.is_org_admin(org_id));

drop policy if exists org_invites_modify on public.org_invites;
create policy org_invites_modify on public.org_invites
  for all to authenticated
  using (public.is_platform_admin() or public.is_org_admin(org_id))
  with check (public.is_platform_admin() or public.is_org_admin(org_id));

-- 3. Platform-wide visibility (additive policies — RLS ORs them in) -----------
drop policy if exists orgs_platform_select on public.orgs;
create policy orgs_platform_select on public.orgs
  for select to authenticated using (public.is_platform_admin());

drop policy if exists orgs_platform_insert on public.orgs;
create policy orgs_platform_insert on public.orgs
  for insert to authenticated with check (public.is_platform_admin());

drop policy if exists org_members_platform_select on public.org_members;
create policy org_members_platform_select on public.org_members
  for select to authenticated using (public.is_platform_admin());

drop policy if exists org_members_platform_modify on public.org_members;
create policy org_members_platform_modify on public.org_members
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists profiles_platform_select on public.profiles;
create policy profiles_platform_select on public.profiles
  for select to authenticated using (public.is_platform_admin());

drop policy if exists profiles_platform_update on public.profiles;
create policy profiles_platform_update on public.profiles
  for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- 4. Invite-aware signup --------------------------------------------------------
-- If a pending invite matches the new user's email, they join THAT org at the
-- invited tier. Otherwise: the legacy shared-org path, unchanged.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  shared_org_id uuid;
  inv record;
begin
  select * into inv
  from public.org_invites
  where lower(email) = lower(new.email) and accepted_at is null
  order by created_at desc
  limit 1;

  if inv.id is not null then
    insert into public.profiles (id, email, default_org_id)
    values (new.id, new.email, inv.org_id)
    on conflict (id) do nothing;

    insert into public.org_members (org_id, user_id, tier)
    values (inv.org_id, new.id, inv.tier)
    on conflict (org_id, user_id) do nothing;

    update public.org_invites set accepted_at = now() where id = inv.id;
    return new;
  end if;

  -- Legacy shared-org fallback (0006 behavior, unchanged)
  select id into shared_org_id from public.orgs order by created_at asc limit 1;

  if shared_org_id is null then
    insert into public.orgs (name, owner_id)
    values (coalesce(new.raw_user_meta_data->>'org_name', 'Platypus'), new.id)
    returning id into shared_org_id;
  end if;

  insert into public.profiles (id, email, default_org_id)
  values (new.id, new.email, shared_org_id)
  on conflict (id) do nothing;

  insert into public.org_members (org_id, user_id, tier)
  values (shared_org_id, new.id, 'member')
  on conflict (org_id, user_id) do nothing;

  return new;
end;
$$;

-- 5. Seed yourself (EDIT THE EMAIL, then run):
-- insert into public.platform_admins (user_id)
--   select id from auth.users where email = 'chad.trim@gmail.com'
-- on conflict do nothing;
