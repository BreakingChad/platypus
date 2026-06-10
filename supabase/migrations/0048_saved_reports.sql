-- 0048_saved_reports — Analytics v1: admin-built reports + dashboard pins.
-- A saved report is a tiny declarative definition (source, groupBy, metric,
-- filters) evaluated client-side by lib/reports.ts — the same engine the
-- standard reports run through. Pinned reports render on the dashboard tab.

create table if not exists public.saved_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  description text,
  definition jsonb not null default '{}'::jsonb,
  pinned boolean not null default false,
  position integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists saved_reports_org_idx on public.saved_reports (org_id, position);

alter table public.saved_reports enable row level security;

drop policy if exists saved_reports_select on public.saved_reports;
create policy saved_reports_select on public.saved_reports
  for select to authenticated using (public.is_org_member(org_id));

drop policy if exists saved_reports_modify on public.saved_reports;
create policy saved_reports_modify on public.saved_reports
  for all to authenticated
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

drop trigger if exists touch_saved_reports on public.saved_reports;
create trigger touch_saved_reports before update on public.saved_reports
  for each row execute function public.touch_updated_at();
