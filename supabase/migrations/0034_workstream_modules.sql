-- 0034_workstream_modules.sql
-- Give each work stream its OWN modules so selecting a work stream loads its own
-- flow. Modules already hang off a pipeline stage (stage_key); this adds the
-- second axis: which work stream they belong to. Existing modules are
-- backfilled onto each org's default (or first) work stream. Idempotent.

alter table public.workflow_modules
  add column if not exists workstream_id uuid
  references public.workstreams(id) on delete cascade;
create index if not exists workflow_modules_ws_idx on public.workflow_modules (workstream_id);

-- Backfill: attach every existing module to its org's default work stream
-- (falling back to the earliest-created active one).
update public.workflow_modules m
set workstream_id = ws.id
from (
  select distinct on (org_id) org_id, id
  from public.workstreams
  where status = 'active'
  order by org_id, is_default desc, created_at asc
) ws
where m.org_id = ws.org_id
  and m.workstream_id is null;
