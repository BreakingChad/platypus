-- 0009_documents.sql
-- Per-study document management. Documents + versions tables in public.*;
-- file content in private storage bucket 'study-documents' with object-level
-- RLS that scopes access to the owning org. Idempotent / no destructive ops.

create table if not exists public.documents (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.orgs(id) on delete cascade,
  study_id            uuid not null references public.studies(id) on delete cascade,
  category            text not null,
  doc_type            text not null,
  doc_type_code       text,
  title               text not null,
  description         text,
  metadata            jsonb not null default '{}'::jsonb,
  current_version_id  uuid,
  status              text not null default 'active',
  archived            boolean not null default false,
  archived_at         timestamptz,
  archived_by         uuid references auth.users(id) on delete set null,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists documents_study_idx     on public.documents (study_id, category, created_at desc);
create index if not exists documents_org_idx       on public.documents (org_id);
create index if not exists documents_archived_idx  on public.documents (org_id, archived);

drop trigger if exists touch_documents_updated_at on public.documents;
create trigger touch_documents_updated_at before update on public.documents
  for each row execute function public.touch_updated_at();

create table if not exists public.document_versions (
  id                  uuid primary key default gen_random_uuid(),
  document_id         uuid not null references public.documents(id) on delete cascade,
  version_label       text not null,
  file_path           text not null,
  original_filename   text,
  file_size           bigint not null default 0,
  mime_type           text,
  metadata            jsonb not null default '{}'::jsonb,
  uploaded_by         uuid references auth.users(id) on delete set null,
  uploaded_at         timestamptz not null default now(),
  archived            boolean not null default false,
  archived_at         timestamptz,
  archived_by         uuid references auth.users(id) on delete set null
);
create index if not exists document_versions_doc_idx
  on public.document_versions (document_id, uploaded_at desc);

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'documents_current_version_fk'
      and table_schema = 'public'
  ) then
    alter table public.documents
      add constraint documents_current_version_fk
      foreign key (current_version_id)
      references public.document_versions(id)
      on delete set null;
  end if;
end$$;

alter table public.documents          enable row level security;
alter table public.document_versions  enable row level security;

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
  for select to authenticated using (public.is_org_member(org_id));

drop policy if exists documents_modify on public.documents;
create policy documents_modify on public.documents
  for all to authenticated
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

drop policy if exists document_versions_select on public.document_versions;
create policy document_versions_select on public.document_versions
  for select to authenticated
  using (exists (
    select 1 from public.documents d
    where d.id = document_id and public.is_org_member(d.org_id)
  ));

drop policy if exists document_versions_modify on public.document_versions;
create policy document_versions_modify on public.document_versions
  for all to authenticated
  using (exists (
    select 1 from public.documents d
    where d.id = document_id and public.is_org_admin(d.org_id)
  ))
  with check (exists (
    select 1 from public.documents d
    where d.id = document_id and public.is_org_admin(d.org_id)
  ));

insert into storage.buckets (id, name, public)
  values ('study-documents', 'study-documents', false)
  on conflict (id) do nothing;

drop policy if exists "study_docs_select" on storage.objects;
create policy "study_docs_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'study-documents'
    and public.is_org_member( ((storage.foldername(name))[1])::uuid )
  );

drop policy if exists "study_docs_insert" on storage.objects;
create policy "study_docs_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'study-documents'
    and public.is_org_admin( ((storage.foldername(name))[1])::uuid )
  );

drop policy if exists "study_docs_update" on storage.objects;
create policy "study_docs_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'study-documents'
    and public.is_org_admin( ((storage.foldername(name))[1])::uuid )
  )
  with check (
    bucket_id = 'study-documents'
    and public.is_org_admin( ((storage.foldername(name))[1])::uuid )
  );

drop policy if exists "study_docs_delete" on storage.objects;
create policy "study_docs_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'study-documents'
    and public.is_org_admin( ((storage.foldername(name))[1])::uuid )
  );

do $$
declare t text;
begin
  for t in select unnest(array['documents','document_versions']) loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end$$;
