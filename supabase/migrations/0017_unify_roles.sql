-- 0017_unify_roles.sql
-- Unify Team Builder roles with Access Roles (05/29 product decision).
-- A team role's IDENTITY now comes from an access role (access_role_id);
-- team_roles remains the assignment join (team + hierarchy + holders) that
-- tasks and the work-stream engine already reference, so nothing breaks.
-- Legacy title-only roles keep working (access_role_id null).
-- Best-effort backfill links by exact name match. Idempotent.

alter table public.team_roles add column if not exists access_role_id uuid
  references public.access_roles(id) on delete set null;
create index if not exists team_roles_access_role_idx on public.team_roles (access_role_id);

update public.team_roles tr
set access_role_id = ar.id
from public.access_roles ar
where tr.access_role_id is null
  and ar.org_id = tr.org_id
  and lower(ar.name) = lower(tr.title);
