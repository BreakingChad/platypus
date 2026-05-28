-- 0010_stage_entered_at.sql
-- Per-stage entry timestamp so study health measures time in the CURRENT
-- stage, not cumulative time since commit/intake. Backfills from the most
-- recent stage_changed audit event (= when the study entered its current
-- stage), falling back to committed_at / intake_date / created_at.
-- Idempotent / non-destructive. studies is already in the realtime publication.

alter table public.studies add column if not exists stage_entered_at timestamptz;

update public.studies s
set stage_entered_at = coalesce(
  (select max(a.created_at) from public.audit_events a
     where a.entity_type = 'study'
       and a.entity_id = s.id
       and a.action = 'stage_changed'),
  s.committed_at, s.intake_date, s.created_at
)
where s.stage_entered_at is null;
