-- 0016_profiles_org_select.sql
-- BUG FIX: profiles RLS only allowed reading YOUR OWN row
-- (profiles_select_self), so every other member rendered as "(unknown)" in
-- Members, assignee pickers, OOO delegate selection, and the covering
-- banner. Adds an org-scoped read policy via a security-definer helper
-- (avoids RLS recursion on org_members). Idempotent / non-destructive.

create or replace function public.shares_org_with(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.org_members me
    join public.org_members them on them.org_id = me.org_id
    where me.user_id = auth.uid()
      and them.user_id = _user_id
  );
$$;

drop policy if exists "profiles_select_org" on public.profiles;
create policy "profiles_select_org" on public.profiles
  for select to authenticated
  using ( id = auth.uid() or public.shares_org_with(id) );
