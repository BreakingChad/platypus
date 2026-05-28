-- 0011_doc_actions.sql
-- Send-for-action: link a task to a document + carry the action type
-- (review / sign / acknowledge / training). The e-signature itself is a
-- hash-chained audit_event on the document, so no separate signatures table
-- is needed. Idempotent / non-destructive. tasks is already in realtime.

alter table public.tasks add column if not exists document_id uuid
  references public.documents(id) on delete cascade;
alter table public.tasks add column if not exists action_type text;

create index if not exists tasks_document_idx on public.tasks (document_id);
