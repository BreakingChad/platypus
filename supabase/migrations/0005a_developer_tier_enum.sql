-- 0005a — add the new enum value (Postgres requires this to commit before being usable)
ALTER TYPE public.member_tier ADD VALUE IF NOT EXISTS 'developer';
