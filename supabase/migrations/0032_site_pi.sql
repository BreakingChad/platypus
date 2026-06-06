-- 0032: a study at a site has its own PI — multi-site means multi-PI.
-- Per-site PI lives on the study_sites join, not the study. Idempotent.
alter table public.study_sites add column if not exists pi_name text;
