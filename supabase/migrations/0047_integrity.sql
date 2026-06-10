-- 0047_integrity — P0 fixes from the 2026-06-09 whole-app review.
--
-- 1. tasks.template_id: spawn idempotency keyed on the TEMPLATE, not the
--    title (same-titled tasks across modules were silently dropped).
-- 2. tasks.receipt_of_task_id: handoff receipts dedupe on the source task,
--    not the title.
-- 3. audit chain hardening:
--    a. audit_events.ts — the exact client timestamp string that was hashed
--       (it was previously hashed but never stored, so content verification
--       could never pass; from 0047 on it can).
--    b. linkage normalization: legacy rows are relinked into one canonical
--       chain per entity (created_at, id order). Legacy content hashes are
--       linkage-verified only — see lib/auditLog.ts verifyChain.
--    c. unique indexes so concurrent writers can no longer fork a chain:
--       at most one successor per link, at most one root per entity.
--       Writers retry on conflict.

-- 1 + 2 ─ task lineage columns ------------------------------------------------
alter table public.tasks add column if not exists template_id uuid
  references public.workflow_task_templates(id) on delete set null;
alter table public.tasks add column if not exists receipt_of_task_id uuid
  references public.tasks(id) on delete set null;
create index if not exists tasks_tpl_idem_idx
  on public.tasks (study_id, stage_key, template_id)
  where template_id is not null;
create index if not exists tasks_receipt_idx
  on public.tasks (receipt_of_task_id)
  where receipt_of_task_id is not null;

-- 3a ─ store the hashed timestamp ----------------------------------------------
alter table public.audit_events add column if not exists ts text;

-- 3b ─ normalize legacy linkage into one canonical chain per entity -------------
update public.audit_events e
set prev_hash = x.expected_prev
from (
  select id,
         lag(event_hash) over (
           partition by entity_type, entity_id
           order by created_at, id
         ) as expected_prev
  from public.audit_events
  where entity_id is not null
) x
where e.id = x.id
  and e.prev_hash is distinct from x.expected_prev;

-- 3c ─ fork protection -----------------------------------------------------------
create unique index if not exists audit_chain_link_uniq
  on public.audit_events (entity_type, entity_id, prev_hash)
  where entity_id is not null and prev_hash is not null;
create unique index if not exists audit_chain_root_uniq
  on public.audit_events (entity_type, entity_id)
  where entity_id is not null and prev_hash is null;
