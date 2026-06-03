-- 0014_team_roles_org.sql
-- BUG FIX: team_roles and team_role_holders were created without org_id,
-- but the app's generic table hook stamps org_id on insert and filters
-- selects by it — so adding roles silently failed and role lists read empty
-- (breaking the Inbox team tab and escalation routing).
-- Adds org_id to both, backfills from the owning team, indexes, and ensures
-- realtime publication. Idempotent / non-destructive.

alter table public.team_roles add column if not exists org_id uuid
  references public.orgs(id) on delete cascade;
update public.team_roles tr
set org_id = t.org_id
from public.teams t
where tr.team_id = t.id and tr.org_id is null;
create index if not exists team_roles_org_idx on public.team_roles (org_id);

alter table public.team_role_holders add column if not exists org_id uuid
  references public.orgs(id) on delete cascade;
update public.team_role_holders h
set org_id = tr.org_id
from public.team_roles tr
where h.team_role_id = tr.id and h.org_id is null;
create index if not exists team_role_holders_org_idx on public.team_role_holders (org_id);

do $$
declare t text;
begin
  for t in select unnest(array['team_roles','team_role_holders']) loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end$$;
