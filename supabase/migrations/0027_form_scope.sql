-- 0027: intake form scope (R2). internal = the study-creation wizard;
-- external = public submissions; specialized = extra named forms.
-- Onboarding wants at least one internal + one external. Idempotent.
alter table public.intake_forms add column if not exists scope text not null default 'specialized';
