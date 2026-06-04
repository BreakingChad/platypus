-- 0022: external intake forms (Wave G).
-- Forms are admin-built from study field definitions, shared by public link,
-- and frozen as a field SNAPSHOT at activation so submissions stay bound to
-- the version they were submitted on. The public (anon) can read ACTIVE
-- forms and insert submissions to them — nothing else. Idempotent.

create table if not exists public.intake_forms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'draft',          -- draft | active | inactive | archived
  slug text not null,
  version integer not null default 1,
  copied_from uuid references public.intake_forms(id) on delete set null,
  -- Field snapshot, frozen at activation:
  -- [{ key, label, section, field_type, required, values: [] }]
  fields jsonb not null default '[]'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug)
);
create index if not exists intake_forms_org_idx on public.intake_forms (org_id, status);

create table if not exists public.form_submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  form_id uuid not null references public.intake_forms(id) on delete restrict,
  form_title text not null,                      -- denormalized for the queue
  status text not null default 'new',            -- new | committed | declined
  values jsonb not null default '{}'::jsonb,
  submitter_name text,
  submitter_email text,
  study_id uuid references public.studies(id) on delete set null,
  declined_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists form_submissions_org_idx
  on public.form_submissions (org_id, status, created_at desc);

alter table public.intake_forms     enable row level security;
alter table public.form_submissions enable row level security;

-- Anyone can read an ACTIVE form (that's what renders the public page);
-- members see all of their org's forms; only admins change them.
drop policy if exists intake_forms_select on public.intake_forms;
create policy intake_forms_select on public.intake_forms
  for select using (status = 'active' or public.is_org_member(org_id));

drop policy if exists intake_forms_modify on public.intake_forms;
create policy intake_forms_modify on public.intake_forms
  for all to authenticated
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

-- The public can SUBMIT to an active form. Only members read or triage.
drop policy if exists form_submissions_insert on public.form_submissions;
create policy form_submissions_insert on public.form_submissions
  for insert to anon, authenticated
  with check (
    exists (
      select 1 from public.intake_forms f
      where f.id = form_id and f.status = 'active' and f.org_id = org_id
    )
  );

drop policy if exists form_submissions_select on public.form_submissions;
create policy form_submissions_select on public.form_submissions
  for select to authenticated using (public.is_org_member(org_id));

drop policy if exists form_submissions_update on public.form_submissions;
create policy form_submissions_update on public.form_submissions
  for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

drop trigger if exists touch_intake_forms_updated_at on public.intake_forms;
create trigger touch_intake_forms_updated_at before update on public.intake_forms
  for each row execute function public.touch_updated_at();
