-- 0015_feasibility.sql
-- Feasibility data on studies: M11 structured protocol (ingested sections)
-- and acuity scoring live in one jsonb column. Shapes are managed by the
-- client (lib/feasibility.ts). Idempotent / non-destructive.

alter table public.studies add column if not exists feasibility jsonb
  not null default '{}'::jsonb;
