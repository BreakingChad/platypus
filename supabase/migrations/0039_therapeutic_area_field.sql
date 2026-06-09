-- 0039_therapeutic_area_field.sql
-- A standard 'Therapeutic area' study field in the Organizational section, as a
-- dropdown. Its option list is managed by the new Therapeutic Areas setup tool
-- (Settings → Foundation), which simply edits this field's options.values.
-- Key 'therapeuticArea' maps to studies.therapeutic_area via KEY_TO_COLUMN, so
-- the choice saves to the existing column. Idempotent; backfill + future trigger.

create or replace function public.seed_ta_field_v0039(_org_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.field_definitions (org_id, entity_type, key, label, section, field_type, kind, enabled, required, lock_after_commit, edit_tier, position, options)
  values (_org_id, 'study', 'therapeuticArea', 'Therapeutic area', 'Organizational', 'dropdown',
          'standard', true, false, false, 'admin', 2,
          '{"values":["Oncology","Cardiology","Neurology","Immunology","Infectious Disease","Endocrinology","Respiratory","Rare Disease"]}'::jsonb)
  on conflict (org_id, entity_type, key) do nothing;
end$fn$;

do $$
declare o record;
begin
  for o in select id from public.orgs loop
    perform public.seed_ta_field_v0039(o.id);
  end loop;
end$$;

create or replace function public.seed_ta_field_v0039_trg()
returns trigger language plpgsql security definer set search_path = public as $t$
begin
  perform public.seed_ta_field_v0039(new.id);
  return new;
end$t$;

drop trigger if exists seed_ta_field_0039 on public.orgs;
create trigger seed_ta_field_0039 after insert on public.orgs
  for each row execute function public.seed_ta_field_v0039_trg();
