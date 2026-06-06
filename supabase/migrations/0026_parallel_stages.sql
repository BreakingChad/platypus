-- 0026: parallel stage grouping for the visual workstream flow (Wave P).
-- Stages sharing a parallel_group render stacked in one lane (run together);
-- null = its own sequential step. Idempotent.
alter table public.pipeline_stages add column if not exists parallel_group integer;
