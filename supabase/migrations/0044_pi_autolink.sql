-- 0044_pi_autolink — keep studies.pi_user_id fresh without a picker UI.
--
-- pi_name stays the edited surface (schema-driven field). The linkage
-- maintains itself:
--   • study's pi_name changes        → relink to the unique matching profile
--   • a profile's name changes        → relink studies matching old/new name
--   • a new user signs up             → their studies link on first save
-- Ambiguous names (two users with the same full name) link to nobody —
-- a wrong PI is worse than an unlinked one.

-- Unique-match lookup --------------------------------------------------------
create or replace function public.pi_user_for_name(p_name text)
returns uuid
language sql
stable
as $$
  select case when count(*) = 1 then (min(id::text))::uuid else null end
  from public.profiles
  where full_name is not null
    and trim(full_name) <> ''
    and lower(trim(full_name)) = lower(trim(coalesce(p_name, '')));
$$;

-- Study side: recompute when pi_name changes ---------------------------------
create or replace function public.sync_study_pi_link()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or (new.pi_name is distinct from old.pi_name) then
    new.pi_user_id := public.pi_user_for_name(new.pi_name);
  end if;
  return new;
end;
$$;

drop trigger if exists studies_sync_pi_link on public.studies;
create trigger studies_sync_pi_link
  before insert or update on public.studies
  for each row execute function public.sync_study_pi_link();

-- Profile side: relink when a name appears or changes ------------------------
create or replace function public.relink_pi_on_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text := '';
  v_new text := '';
begin
  if tg_op = 'UPDATE' then
    v_old := lower(trim(coalesce(old.full_name, '')));
  end if;
  v_new := lower(trim(coalesce(new.full_name, '')));
  if v_new = v_old then
    return new;
  end if;

  update public.studies s
  set pi_user_id = public.pi_user_for_name(s.pi_name)
  where coalesce(s.pi_name, '') <> ''
    and lower(trim(s.pi_name)) in (v_old, v_new);
  return new;
end;
$$;

drop trigger if exists profiles_relink_pi on public.profiles;
create trigger profiles_relink_pi
  after insert or update on public.profiles
  for each row execute function public.relink_pi_on_profile_change();

-- One-time relink of everything ----------------------------------------------
update public.studies s
set pi_user_id = public.pi_user_for_name(s.pi_name)
where coalesce(s.pi_name, '') <> '';
