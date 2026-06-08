-- 0036_field_gaps.sql
-- Adds the obviously-missing site and study fields. The Details/profile editors
-- are field-driven, so seeding field_definitions surfaces them automatically.
-- Idempotent: backfills every existing org now, and a trigger seeds future orgs.
-- Safe to re-run (ON CONFLICT (org_id, entity_type, key) DO NOTHING).

create or replace function public.seed_extra_fields_v0036(_org_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  f jsonb;
  -- SITE: credentials, capabilities, network
  site_fields jsonb := $j$[
    {"key":"parentNetwork","label":"Parent network / health system","section":"Identity","field_type":"text","position":30},
    {"key":"clia","label":"CLIA number","section":"Regulatory","field_type":"text","position":31},
    {"key":"capAccredited","label":"CAP accredited","section":"Regulatory","field_type":"boolean","position":32},
    {"key":"fwaExpiry","label":"FWA expiration","section":"Regulatory","field_type":"date","position":33},
    {"key":"therapeuticAreas","label":"Therapeutic areas","section":"Capabilities","field_type":"text","position":40},
    {"key":"phasesSupported","label":"Phases supported","section":"Capabilities","field_type":"text","position":41},
    {"key":"emrSystem","label":"EMR / EHR system","section":"Capabilities","field_type":"text","position":42},
    {"key":"edcExperience","label":"EDC experience","section":"Capabilities","field_type":"text","position":43},
    {"key":"pharmacyIds","label":"Pharmacy / IDS on site","section":"Capabilities","field_type":"boolean","position":44},
    {"key":"freezerCapacity","label":"Freezer capacity (-20 / -80 / LN2)","section":"Capabilities","field_type":"text","position":45},
    {"key":"onSiteLab","label":"On-site lab","section":"Capabilities","field_type":"boolean","position":46},
    {"key":"onSiteImaging","label":"On-site imaging","section":"Capabilities","field_type":"boolean","position":47},
    {"key":"patientPopulation","label":"Patient population / demographics","section":"Capabilities","field_type":"text","position":48},
    {"key":"languages","label":"Languages supported","section":"Capabilities","field_type":"text","position":49}
  ]$j$::jsonb;
  -- STUDY: surface NCT, study design, milestone dates, contacts, budget
  study_fields jsonb := $j$[
    {"key":"nct","label":"NCT / ClinicalTrials.gov ID","section":"Organizational","field_type":"text","position":30,"options":null},
    {"key":"studyDesign","label":"Study design","section":"Design","field_type":"dropdown","position":40,"options":{"values":["Interventional","Observational","Expanded access"]}},
    {"key":"randomization","label":"Randomization","section":"Design","field_type":"dropdown","position":41,"options":{"values":["Randomized","Non-randomized","N/A"]}},
    {"key":"masking","label":"Masking / blinding","section":"Design","field_type":"dropdown","position":42,"options":{"values":["Open label","Single blind","Double blind","Triple blind"]}},
    {"key":"numArms","label":"Number of arms","section":"Design","field_type":"number","position":43,"options":null},
    {"key":"irbApprovalDate","label":"IRB approval date","section":"Milestones","field_type":"date","position":50,"options":null},
    {"key":"irbExpirationDate","label":"IRB expiration date","section":"Milestones","field_type":"date","position":51,"options":null},
    {"key":"sivDate","label":"Site initiation visit (SIV) date","section":"Milestones","field_type":"date","position":52,"options":null},
    {"key":"fpiDate","label":"First patient in (FPI)","section":"Milestones","field_type":"date","position":53,"options":null},
    {"key":"lpiDate","label":"Last patient in (LPI)","section":"Milestones","field_type":"date","position":54,"options":null},
    {"key":"contractExecutionDate","label":"Contract execution date","section":"Milestones","field_type":"date","position":55,"options":null},
    {"key":"craContact","label":"Monitor / CRA contact","section":"Contacts","field_type":"text","position":60,"options":null},
    {"key":"sponsorContact","label":"Sponsor contact","section":"Contacts","field_type":"text","position":61,"options":null},
    {"key":"budgetPerPatient","label":"Budget per patient","section":"Financial","field_type":"number","position":70,"options":null},
    {"key":"totalBudget","label":"Total budget","section":"Financial","field_type":"number","position":71,"options":null}
  ]$j$::jsonb;
begin
  for f in select * from jsonb_array_elements(site_fields) loop
    insert into public.field_definitions (org_id, entity_type, key, label, section, field_type, kind, enabled, required, lock_after_commit, edit_tier, position, options)
    values (_org_id, 'site', f->>'key', f->>'label', f->>'section', (f->>'field_type')::public.field_type,
            'standard', true, false, false, 'admin', (f->>'position')::int, null)
    on conflict (org_id, entity_type, key) do nothing;
  end loop;
  for f in select * from jsonb_array_elements(study_fields) loop
    insert into public.field_definitions (org_id, entity_type, key, label, section, field_type, kind, enabled, required, lock_after_commit, edit_tier, position, options)
    values (_org_id, 'study', f->>'key', f->>'label', f->>'section', (f->>'field_type')::public.field_type,
            'standard', true, false, false, 'admin', (f->>'position')::int,
            case when f->'options' = 'null'::jsonb or f->'options' is null then null else f->'options' end)
    on conflict (org_id, entity_type, key) do nothing;
  end loop;
end$fn$;

-- Backfill every existing org.
do $$
declare o record;
begin
  for o in select id from public.orgs loop
    perform public.seed_extra_fields_v0036(o.id);
  end loop;
end$$;

-- Seed future orgs too (independent of the main seed_org_data trigger).
create or replace function public.seed_extra_fields_v0036_trg()
returns trigger language plpgsql security definer set search_path = public as $t$
begin
  perform public.seed_extra_fields_v0036(new.id);
  return new;
end$t$;

drop trigger if exists seed_extra_fields_0036 on public.orgs;
create trigger seed_extra_fields_0036 after insert on public.orgs
  for each row execute function public.seed_extra_fields_v0036_trg();
