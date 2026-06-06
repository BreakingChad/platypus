-- 0030: remove "Training status" field for now (Chad, 2026-06-04).
-- Disabled (not deleted) so any captured values survive if it returns.
-- Also dropped from the standard catalog (lib/fieldCatalog.ts). Idempotent.
update public.field_definitions set enabled = false where key = 'trainingStatus';
