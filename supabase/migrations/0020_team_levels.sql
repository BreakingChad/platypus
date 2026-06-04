-- 0020: Team Builder levels (Wave F3).
-- Teams mirror the org chart: numbered level boxes contain roles; one level
-- manages assignments. Plus the team card's group email and site scoping.
-- Idempotent.
alter table public.teams add column if not exists group_email text;
alter table public.teams add column if not exists site_ids jsonb not null default '[]'::jsonb;       -- empty = All Sites
alter table public.teams add column if not exists level_settings jsonb not null default '{}'::jsonb; -- { max_level, assign_level }
