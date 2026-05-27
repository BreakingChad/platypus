-- 0005b — backfill existing members + extend helpers + seed default site fields

-- 1. Backfill: existing org_members → developer tier.
UPDATE public.org_members SET tier = 'developer'::public.member_tier;

-- 2. Helper: treat developer as admin everywhere is_org_admin is checked.
CREATE OR REPLACE FUNCTION public.is_org_admin(_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.org_id = _org_id
      AND m.user_id = auth.uid()
      AND m.tier IN ('owner','admin','developer')
  );
$$;

-- 3. Default site fields for every existing org.
DO $$
DECLARE
  o record;
  f jsonb;
  site_fields jsonb := $j$[
    {"key":"siteName","label":"Site name","section":"Identity","field_type":"text","position":1,"required":true},
    {"key":"siteCode","label":"Site code","section":"Identity","field_type":"text","position":2,"required":true},
    {"key":"institutionType","label":"Institution type","section":"Identity","field_type":"dropdown","position":3,"required":false},
    {"key":"address1","label":"Address line 1","section":"Location","field_type":"text","position":4,"required":false},
    {"key":"address2","label":"Address line 2","section":"Location","field_type":"text","position":5,"required":false},
    {"key":"city","label":"City","section":"Location","field_type":"text","position":6,"required":false},
    {"key":"state","label":"State / region","section":"Location","field_type":"text","position":7,"required":false},
    {"key":"postalCode","label":"Postal code","section":"Location","field_type":"text","position":8,"required":false},
    {"key":"country","label":"Country","section":"Location","field_type":"text","position":9,"required":false},
    {"key":"timezone","label":"Timezone","section":"Location","field_type":"text","position":10,"required":false},
    {"key":"primaryInvestigator","label":"Primary investigator","section":"Contacts","field_type":"person","position":11,"required":false},
    {"key":"siteContactName","label":"Site contact name","section":"Contacts","field_type":"text","position":12,"required":false},
    {"key":"siteContactEmail","label":"Site contact email","section":"Contacts","field_type":"text","position":13,"required":false},
    {"key":"siteContactPhone","label":"Site contact phone","section":"Contacts","field_type":"text","position":14,"required":false},
    {"key":"irbName","label":"IRB name","section":"Regulatory","field_type":"text","position":15,"required":false},
    {"key":"irbContact","label":"IRB contact","section":"Regulatory","field_type":"text","position":16,"required":false},
    {"key":"fwa","label":"FWA number","section":"Regulatory","field_type":"text","position":17,"required":false},
    {"key":"iorg","label":"IORG number","section":"Regulatory","field_type":"text","position":18,"required":false},
    {"key":"siteStatus","label":"Site status","section":"Operations","field_type":"dropdown","position":19,"required":false},
    {"key":"activatedDate","label":"Site activated date","section":"Operations","field_type":"date","position":20,"required":false},
    {"key":"closedDate","label":"Site closed date","section":"Operations","field_type":"date","position":21,"required":false},
    {"key":"notes","label":"Notes","section":"Operations","field_type":"text","position":22,"required":false}
  ]$j$::jsonb;
BEGIN
  FOR o IN SELECT id FROM public.orgs LOOP
    FOR f IN SELECT * FROM jsonb_array_elements(site_fields) LOOP
      INSERT INTO public.field_definitions
        (org_id, entity_type, key, label, section, field_type, kind, enabled, required, lock_after_commit, edit_tier, position)
      VALUES
        (o.id, 'site', f->>'key', f->>'label', f->>'section',
         (f->>'field_type')::public.field_type, 'standard',
         true, (f->>'required')::boolean, false, 'admin', (f->>'position')::int)
      ON CONFLICT (org_id, entity_type, key) DO NOTHING;
    END LOOP;
  END LOOP;
END$$;

-- 4. Extend seed_default_org_data to include site fields for FUTURE orgs.
CREATE OR REPLACE FUNCTION public.seed_default_org_data(_org_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s jsonb; f jsonb; ar jsonb; sf jsonb;
  stages jsonb := $j$[
    {"key":"intake","label":"Intake","icon_key":"inbox","color":"#6366F1","target_days":14,"terminal":false,"is_core":true,"position":1},
    {"key":"study_startup","label":"Study startup","icon_key":"folder","color":"#0284C7","target_days":14,"terminal":false,"is_core":true,"position":2},
    {"key":"feasibility","label":"Feasibility","icon_key":"search","color":"#059669","target_days":21,"terminal":false,"is_core":true,"position":3},
    {"key":"site_selection","label":"Site selection","icon_key":"building","color":"#b45309","target_days":30,"terminal":false,"is_core":true,"position":4},
    {"key":"regulatory","label":"Regulatory / eReg","icon_key":"shield","color":"#7C3AED","target_days":45,"terminal":false,"is_core":true,"position":5},
    {"key":"contract_budget","label":"Contract & budget","icon_key":"dollar","color":"#BE185D","target_days":45,"terminal":false,"is_core":true,"position":6},
    {"key":"site_initiation","label":"Site initiation","icon_key":"rocket","color":"#4F46E5","target_days":30,"terminal":false,"is_core":true,"position":7},
    {"key":"activation","label":"Activated","icon_key":"check","color":"#059669","target_days":0,"terminal":true,"is_core":true,"position":8}
  ]$j$::jsonb;
  fields jsonb := $j$[
    {"key":"shortTitle","label":"Short title","section":"Organizational","field_type":"text","position":1},
    {"key":"protocolNumber","label":"Protocol number","section":"Organizational","field_type":"text","position":2},
    {"key":"protocolVersion","label":"Protocol version","section":"Organizational","field_type":"text","position":3},
    {"key":"protocolDate","label":"Protocol date","section":"Organizational","field_type":"date","position":4},
    {"key":"cro","label":"CRO","section":"Organizational","field_type":"text","position":5},
    {"key":"disease","label":"Disease / indication","section":"Organizational","field_type":"text","position":6},
    {"key":"intervention","label":"Intervention","section":"Organizational","field_type":"text","position":7},
    {"key":"primarySiteName","label":"Primary study site","section":"Per-Site","field_type":"text","position":8},
    {"key":"sponsorSiteNumber","label":"Sponsor site #","section":"Per-Site","field_type":"text","position":9},
    {"key":"estimatedActivationDate","label":"Estimated activation date","section":"Per-Site","field_type":"date","position":10},
    {"key":"irbProtocolNumber","label":"IRB protocol #","section":"Regulatory","field_type":"text","position":11},
    {"key":"irbType","label":"IRB type","section":"Regulatory","field_type":"dropdown","position":12},
    {"key":"irbName","label":"IRB name","section":"Regulatory","field_type":"text","position":13},
    {"key":"indIdeNumber","label":"IND / IDE number","section":"Regulatory","field_type":"text","position":14},
    {"key":"fdaRegulated","label":"FDA regulated","section":"Regulatory","field_type":"boolean","position":15},
    {"key":"fundingSource","label":"Funding source","section":"Financial","field_type":"text","position":16},
    {"key":"startupFees","label":"Startup fees","section":"Financial","field_type":"number","position":17},
    {"key":"costCenter","label":"Cost center","section":"Financial","field_type":"text","position":18},
    {"key":"paymentTerms","label":"Payment terms","section":"Financial","field_type":"text","position":19},
    {"key":"accrualGoal","label":"Enrollment target","section":"Operational","field_type":"number","position":20},
    {"key":"edcPlatform","label":"EDC platform","section":"Operational","field_type":"text","position":21},
    {"key":"trainingStatus","label":"Training status","section":"Operational","field_type":"dropdown","position":22}
  ]$j$::jsonb;
  access_recs jsonb := $j$[
    {"name":"Director","desc":"Cross-portfolio authority. Configures the app and approves exceptions.","modules":{"all":"admin"},"scope":"all"},
    {"name":"Operations Manager","desc":"Day-to-day operations across teams.","modules":{"all":"edit"},"scope":"all"},
    {"name":"Coordinator","desc":"Per-study execution.","modules":{"studies":"edit","documents":"read"},"scope":"assigned"},
    {"name":"Regulatory","desc":"Document-centric. Approvals, expirations, binder hygiene.","modules":{"documents":"edit","studies":"read"},"scope":"assigned"},
    {"name":"Principal Investigator","desc":"Clinical lead. Approvals and escalations.","modules":{"studies":"read","approvals":"edit"},"scope":"assigned"}
  ]$j$::jsonb;
  site_fields jsonb := $j$[
    {"key":"siteName","label":"Site name","section":"Identity","field_type":"text","position":1,"required":true},
    {"key":"siteCode","label":"Site code","section":"Identity","field_type":"text","position":2,"required":true},
    {"key":"institutionType","label":"Institution type","section":"Identity","field_type":"dropdown","position":3,"required":false},
    {"key":"address1","label":"Address line 1","section":"Location","field_type":"text","position":4,"required":false},
    {"key":"address2","label":"Address line 2","section":"Location","field_type":"text","position":5,"required":false},
    {"key":"city","label":"City","section":"Location","field_type":"text","position":6,"required":false},
    {"key":"state","label":"State / region","section":"Location","field_type":"text","position":7,"required":false},
    {"key":"postalCode","label":"Postal code","section":"Location","field_type":"text","position":8,"required":false},
    {"key":"country","label":"Country","section":"Location","field_type":"text","position":9,"required":false},
    {"key":"timezone","label":"Timezone","section":"Location","field_type":"text","position":10,"required":false},
    {"key":"primaryInvestigator","label":"Primary investigator","section":"Contacts","field_type":"person","position":11,"required":false},
    {"key":"siteContactName","label":"Site contact name","section":"Contacts","field_type":"text","position":12,"required":false},
    {"key":"siteContactEmail","label":"Site contact email","section":"Contacts","field_type":"text","position":13,"required":false},
    {"key":"siteContactPhone","label":"Site contact phone","section":"Contacts","field_type":"text","position":14,"required":false},
    {"key":"irbName","label":"IRB name","section":"Regulatory","field_type":"text","position":15,"required":false},
    {"key":"irbContact","label":"IRB contact","section":"Regulatory","field_type":"text","position":16,"required":false},
    {"key":"fwa","label":"FWA number","section":"Regulatory","field_type":"text","position":17,"required":false},
    {"key":"iorg","label":"IORG number","section":"Regulatory","field_type":"text","position":18,"required":false},
    {"key":"siteStatus","label":"Site status","section":"Operations","field_type":"dropdown","position":19,"required":false},
    {"key":"activatedDate","label":"Site activated date","section":"Operations","field_type":"date","position":20,"required":false},
    {"key":"closedDate","label":"Site closed date","section":"Operations","field_type":"date","position":21,"required":false},
    {"key":"notes","label":"Notes","section":"Operations","field_type":"text","position":22,"required":false}
  ]$j$::jsonb;
BEGIN
  FOR s IN SELECT * FROM jsonb_array_elements(stages) LOOP
    INSERT INTO public.pipeline_stages (org_id, key, label, icon_key, color, target_days, terminal, is_core, position)
    VALUES (_org_id, s->>'key', s->>'label', s->>'icon_key', s->>'color',
            (s->>'target_days')::int, (s->>'terminal')::bool, (s->>'is_core')::bool, (s->>'position')::int)
    ON CONFLICT (org_id, key) DO NOTHING;
  END LOOP;

  FOR f IN SELECT * FROM jsonb_array_elements(fields) LOOP
    INSERT INTO public.field_definitions (org_id, entity_type, key, label, section, field_type, kind, enabled, required, lock_after_commit, edit_tier, position)
    VALUES (_org_id, 'study', f->>'key', f->>'label', f->>'section', (f->>'field_type')::public.field_type,
            'standard', true, false, false, 'admin', (f->>'position')::int)
    ON CONFLICT (org_id, entity_type, key) DO NOTHING;
  END LOOP;

  FOR sf IN SELECT * FROM jsonb_array_elements(site_fields) LOOP
    INSERT INTO public.field_definitions (org_id, entity_type, key, label, section, field_type, kind, enabled, required, lock_after_commit, edit_tier, position)
    VALUES (_org_id, 'site', sf->>'key', sf->>'label', sf->>'section', (sf->>'field_type')::public.field_type,
            'standard', true, (sf->>'required')::boolean, false, 'admin', (sf->>'position')::int)
    ON CONFLICT (org_id, entity_type, key) DO NOTHING;
  END LOOP;

  FOR ar IN SELECT * FROM jsonb_array_elements(access_recs) LOOP
    INSERT INTO public.access_roles (org_id, name, description, builtin, modules, portfolio_scope)
    VALUES (_org_id, ar->>'name', ar->>'desc', true, (ar->'modules')::jsonb, ar->>'scope');
  END LOOP;
END;
$$;
