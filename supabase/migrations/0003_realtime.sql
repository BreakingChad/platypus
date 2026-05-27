-- 0003_realtime.sql
-- Enable Postgres logical replication for the tables the app subscribes to.
-- Idempotent: re-running is a no-op once the publication contains the table.

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'pipeline_stages',
    'teams',
    'team_roles',
    'team_role_holders',
    'access_roles',
    'studies',
    'field_definitions'
  ])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
