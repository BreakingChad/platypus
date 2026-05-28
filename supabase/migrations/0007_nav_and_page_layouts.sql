-- 0007_nav_and_page_layouts.sql
-- Schema for admin-controlled navigation + per-page layouts, scoped per
-- access_role. Idempotent.

ALTER TABLE public.org_members
  ADD COLUMN IF NOT EXISTS access_role_id uuid REFERENCES public.access_roles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS org_members_access_role_idx
  ON public.org_members (access_role_id);

ALTER TABLE public.access_roles
  ADD COLUMN IF NOT EXISTS nav jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.access_roles
  ADD COLUMN IF NOT EXISTS page_layouts jsonb NOT NULL DEFAULT '{}'::jsonb;

do $$
declare t text;
begin
  for t in select unnest(array['org_members']) loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end$$;
