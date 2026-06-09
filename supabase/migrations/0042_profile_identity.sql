-- 0042_profile_identity — first/last name + avatar photos.
--
-- 1. profiles gains first_name / last_name / avatar_url.
-- 2. full_name stays (24+ display sites read it) and is kept in sync both
--    ways by trigger: editing first/last recomputes full_name; legacy writes
--    to full_name re-split into first/last. No display code breaks.
-- 3. Backfill: existing full_name values split on the first space.
-- 4. 'avatars' storage bucket: public read (avatars render in <img> tags
--    without signed-URL churn), writes restricted to the user's own folder
--    (avatars/<auth.uid()>/...). Mirrors the 0009 study-documents pattern.

-- 1 ─ columns ---------------------------------------------------------------
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name  text;
alter table public.profiles add column if not exists avatar_url text;

-- 2 ─ bidirectional name sync ------------------------------------------------
create or replace function public.sync_profile_names()
returns trigger
language plpgsql
as $$
declare
  v_full text;
begin
  if tg_op = 'INSERT' then
    if new.first_name is not null or new.last_name is not null then
      new.full_name := nullif(trim(concat_ws(' ', new.first_name, new.last_name)), '');
    elsif new.full_name is not null then
      v_full := trim(new.full_name);
      new.first_name := nullif(split_part(v_full, ' ', 1), '');
      new.last_name  := nullif(trim(substr(v_full, length(split_part(v_full, ' ', 1)) + 2)), '');
    end if;
  else
    if (new.first_name is distinct from old.first_name)
       or (new.last_name is distinct from old.last_name) then
      new.full_name := nullif(trim(concat_ws(' ', new.first_name, new.last_name)), '');
    elsif new.full_name is distinct from old.full_name and new.full_name is not null then
      v_full := trim(new.full_name);
      new.first_name := nullif(split_part(v_full, ' ', 1), '');
      new.last_name  := nullif(trim(substr(v_full, length(split_part(v_full, ' ', 1)) + 2)), '');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_sync_names on public.profiles;
create trigger profiles_sync_names
  before insert or update on public.profiles
  for each row execute function public.sync_profile_names();

-- 3 ─ backfill ----------------------------------------------------------------
update public.profiles
set first_name = nullif(split_part(trim(full_name), ' ', 1), ''),
    last_name  = nullif(trim(substr(trim(full_name), length(split_part(trim(full_name), ' ', 1)) + 2)), '')
where full_name is not null
  and first_name is null
  and last_name is null;

-- 4 ─ avatars bucket + policies -----------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "avatars_select" on storage.objects;
create policy "avatars_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
