-- 0019: multiselect + list field types.
-- Wave F1 shipped the UI for these end-to-end; this brings the field_type
-- enum up to date so field definitions can be stored with them (the standard
-- catalog's vulnerable-populations multiselect and consent-versions list
-- depend on it). Idempotent — safe to run if the enum was already extended.
alter type public.field_type add value if not exists 'multiselect';
alter type public.field_type add value if not exists 'list';
