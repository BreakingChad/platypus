-- 0024: startup document staging — the "BOP" / pre-binder box of papers.
-- A holding area for early study documents before formal binder/eReg/eISF
-- filing. Bulk-add, tag into one of three buckets, keep the original-study
-- and amendment tracks visible-but-separate, and force a disposition at the
-- terminal stage (file to binder / file to site file / archive). Idempotent.

create table if not exists public.startup_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  study_id uuid not null references public.studies(id) on delete cascade,
  bucket text not null default 'startup',     -- operations | regulatory | startup
  track text not null default 'original',     -- original | amendment
  title text not null,
  note text,
  status text not null default 'staged',      -- staged | filed | archived
  disposition text,                           -- binder | site_file | archived
  filed_note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists startup_documents_study_idx
  on public.startup_documents (study_id, bucket, status);

alter table public.startup_documents enable row level security;

-- Coordinators stage and file these day-to-day, so member-level modify.
drop policy if exists startup_documents_select on public.startup_documents;
create policy startup_documents_select on public.startup_documents
  for select to authenticated using (public.is_org_member(org_id));

drop policy if exists startup_documents_modify on public.startup_documents;
create policy startup_documents_modify on public.startup_documents
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop trigger if exists touch_startup_documents_updated_at on public.startup_documents;
create trigger touch_startup_documents_updated_at before update on public.startup_documents
  for each row execute function public.touch_updated_at();
