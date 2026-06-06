-- 0025: amendments as parallel study tracks (Wave O).
-- An amendment is its own study row on its own status pipeline — NOT an
-- instant lock of the prior version. v1 stays active for months while v2 is
-- worked up; the predecessor only becomes a locked historical snapshot when
-- the amendment supersedes it. Idempotent.

alter table public.studies
  add column if not exists root_study_id uuid references public.studies(id) on delete set null;
alter table public.studies
  add column if not exists amendment_of uuid references public.studies(id) on delete set null;
alter table public.studies
  add column if not exists version_label text;          -- "v2", "BA", "Amd 3" — free text
alter table public.studies
  add column if not exists amendment_purpose text;       -- required when version doesn't change
alter table public.studies
  add column if not exists superseded_at timestamptz;    -- set when a later version takes over
alter table public.studies
  add column if not exists superseded_by uuid references public.studies(id) on delete set null;

-- Lineage lookups: "all versions of this root", "what superseded me".
create index if not exists studies_root_idx on public.studies (root_study_id);
create index if not exists studies_superseded_idx on public.studies (org_id, superseded_at);
