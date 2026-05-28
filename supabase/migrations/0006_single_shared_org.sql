-- 0006_single_shared_org.sql
-- Rewrite handle_new_user so every new signup joins the SHARED org as a member,
-- instead of getting their own isolated org. Idempotent.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  shared_org_id uuid;
BEGIN
  -- The shared org is the first one created.
  SELECT id INTO shared_org_id FROM public.orgs ORDER BY created_at ASC LIMIT 1;

  IF shared_org_id IS NULL THEN
    INSERT INTO public.orgs (name, owner_id)
    VALUES (
      COALESCE(NEW.raw_user_meta_data->>'org_name', 'Platypus'),
      NEW.id
    )
    RETURNING id INTO shared_org_id;
  END IF;

  INSERT INTO public.profiles (id, email, default_org_id)
  VALUES (NEW.id, NEW.email, shared_org_id)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.org_members (org_id, user_id, tier)
  VALUES (shared_org_id, NEW.id, 'member')
  ON CONFLICT (org_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;
