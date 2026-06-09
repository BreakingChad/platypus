-- 0043_staff_and_pi — staff credentials, signature + workday prefs, PI linkage.
--
-- 1. staff_credentials: licenses / GCP training / certifications with expiry
--    dates. Feeds the Expirations surface and future delegation-of-authority
--    logging. Org-scoped RLS; members manage their own rows, admins manage all.
-- 2. profiles: timezone, working_hours (jsonb {start,end,days[]}),
--    signature_name (prefills the Part 11 attestation modal).
-- 3. studies.pi_user_id: real FK linkage for "I'm the PI" — replaces the
--    fragile pi_name string match. Backfilled only where exactly one profile
--    matches the legacy pi_name (ambiguous names left null).

-- 1 ─ staff_credentials ------------------------------------------------------
create table if not exists public.staff_credentials (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'training',          -- training | license | certification | other
  label text not null,                            -- e.g. "GCP Training (CITI)"
  issuer text,                                    -- e.g. "CITI Program"
  identifier text,                                -- cert/license number
  issued_on date,
  expires_on date,                                -- null = doesn't expire
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists staff_credentials_org_user_idx
  on public.staff_credentials (org_id, user_id);
create index if not exists staff_credentials_expiry_idx
  on public.staff_credentials (org_id, expires_on)
  where expires_on is not null;

alter table public.staff_credentials enable row level security;

drop policy if exists staff_credentials_select on public.staff_credentials;
create policy staff_credentials_select on public.staff_credentials
  for select to authenticated
  using (public.is_org_member(org_id));

drop policy if exists staff_credentials_insert_own on public.staff_credentials;
create policy staff_credentials_insert_own on public.staff_credentials
  for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and (user_id = auth.uid() or public.is_org_admin(org_id))
  );

drop policy if exists staff_credentials_update_own on public.staff_credentials;
create policy staff_credentials_update_own on public.staff_credentials
  for update to authenticated
  using (
    public.is_org_member(org_id)
    and (user_id = auth.uid() or public.is_org_admin(org_id))
  )
  with check (
    public.is_org_member(org_id)
    and (user_id = auth.uid() or public.is_org_admin(org_id))
  );

drop policy if exists staff_credentials_delete_own on public.staff_credentials;
create policy staff_credentials_delete_own on public.staff_credentials
  for delete to authenticated
  using (
    public.is_org_member(org_id)
    and (user_id = auth.uid() or public.is_org_admin(org_id))
  );

-- keep updated_at honest
create or replace function public.touch_staff_credentials()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists staff_credentials_touch on public.staff_credentials;
create trigger staff_credentials_touch
  before update on public.staff_credentials
  for each row execute function public.touch_staff_credentials();

-- 2 ─ profile preferences ----------------------------------------------------
alter table public.profiles add column if not exists timezone text;
alter table public.profiles add column if not exists working_hours jsonb;
alter table public.profiles add column if not exists signature_name text;

-- 3 ─ PI linkage ---------------------------------------------------------------
alter table public.studies add column if not exists pi_user_id uuid
  references auth.users(id) on delete set null;
create index if not exists studies_pi_user_idx
  on public.studies (org_id, pi_user_id)
  where pi_user_id is not null;

-- Backfill: link only when exactly ONE profile matches the legacy pi_name.
update public.studies s
set pi_user_id = m.id
from (
  select lower(trim(full_name)) as k, (array_agg(id))[1] as id, count(*) as c
  from public.profiles
  where full_name is not null and trim(full_name) <> ''
  group by 1
) m
where s.pi_user_id is null
  and s.pi_name is not null
  and lower(trim(s.pi_name)) = m.k
  and m.c = 1;
