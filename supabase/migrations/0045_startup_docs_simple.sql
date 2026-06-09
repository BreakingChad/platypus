-- 0045_startup_docs_simple — Startup Docs becomes drag-file-into-bucket.
--
-- eReg/binder filing is parked (EOY). Startup documents are now actual
-- files: drag into a bucket, name it, done. This adds file columns and a
-- member-writable private storage bucket. Track/disposition columns stay
-- (data preserved) but the UI no longer drives them.

alter table public.startup_documents add column if not exists file_path text;
alter table public.startup_documents add column if not exists content_type text;
alter table public.startup_documents add column if not exists size_bytes bigint;

-- Private bucket; downloads go through short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('startup-docs', 'startup-docs', false)
on conflict (id) do nothing;

-- Coordinators work these daily → member-level read/write,
-- org-scoped by the first folder segment (org_id/study_id/file).
drop policy if exists "startup_docs_select" on storage.objects;
create policy "startup_docs_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'startup-docs'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "startup_docs_insert" on storage.objects;
create policy "startup_docs_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'startup-docs'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "startup_docs_delete" on storage.objects;
create policy "startup_docs_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'startup-docs'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );
