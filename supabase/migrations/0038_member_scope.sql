-- 0038_member_scope.sql
-- Per-member scope: which Sites and Therapeutic Areas a member is limited to.
-- Empty array = no restriction (all sites / all TAs). Stored as arrays on the
-- membership row; no new tables. Idempotent / non-destructive. Existing
-- org_members RLS already gates updates to admins.

alter table public.org_members
  add column if not exists site_ids uuid[] not null default '{}';
alter table public.org_members
  add column if not exists therapeutic_areas text[] not null default '{}';
