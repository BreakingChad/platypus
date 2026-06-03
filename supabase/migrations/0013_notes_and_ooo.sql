-- 0013_notes_and_ooo.sql
-- Study notes (lightweight, audit-chained via writeAuditEvent) and
-- out-of-office coverage on org_members (Carol -> Steve).
-- Idempotent / non-destructive.

create table if not exists public.study_notes (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  study_id     uuid not null references public.studies(id) on delete cascade,
  body         text not null,
  author_id    uuid references auth.users(id) on delete set null,
  author_email text,
  created_at   timestamptz not null default now()
);
create index if not exists study_notes_study_idx on public.study_notes (study_id, created_at desc);

alter table public.study_notes enable row level security;
drop policy if exists study_notes_select on public.study_notes;
create policy study_notes_select on public.study_notes
  for select to authenticated using (public.is_org_member(org_id));
-- Any org member can add a note; only admins can delete. No updates (append-only).
drop policy if exists study_notes_insert on public.study_notes;
create policy study_notes_insert on public.study_notes
  for insert to authenticated with check (public.is_org_member(org_id) and author_id = auth.uid());
drop policy if exists study_notes_delete on public.study_notes;
create policy study_notes_delete on public.study_notes
  for delete to authenticated using (public.is_org_admin(org_id));

alter table public.org_members add column if not exists ooo_until timestamptz;
alter table public.org_members add column if not exists ooo_delegate_user_id uuid
  references auth.users(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='study_notes'
  ) then
    execute 'alter publication supabase_realtime add table public.study_notes';
  end if;
end$$;
